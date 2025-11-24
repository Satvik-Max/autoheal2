import { useState, useEffect, useRef, useCallback } from 'react';
import githubService from '../services/githubservice';
import apiService from '../services/apiservice';
import groqService from '../services/groqService';
import { supabase } from '../../lib/supabase';

export const useMonitoring = () => {
  const [monitoredRepos, setMonitoredRepos] = useState(new Set());
  const [monitoringStatus, setMonitoringStatus] = useState({});
  const [healingInProgress, setHealingInProgress] = useState({});
  const [recentPRs, setRecentPRs] = useState([]); 
  const monitoringIntervals = useRef({});
  const healingAttempts = useRef(new Map());
  const isInitialized = useRef(false); 

  // Get GitHub token from Supabase session
  const getGitHubToken = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.provider_token) {
        throw new Error('No GitHub token available. Please sign in with GitHub.');
      }
      return session.provider_token;
    } catch (error) {
      console.error('Error getting GitHub token:', error);
      throw error;
    }
  }, []);

  // Track recent PR for UI display
  const addRecentPR = useCallback((prData) => {
    setRecentPRs(prev => {
      const newPRs = [prData, ...prev.slice(0, 9)]; // Keep last 10 PRs
      return newPRs;
    });
    
    // Auto-remove after 2 minutes
    setTimeout(() => {
      setRecentPRs(prev => prev.filter(pr => pr.id !== prData.id));
    }, 120000);
  }, []);

  const triggerHealingProcess = useCallback(async (repoFullName, failedRun) => {
    const runKey = `${repoFullName}-${failedRun.id}`;
    
    // More strict duplicate prevention
    if (healingAttempts.current.has(runKey)) {
      console.log(`⏭️ Already healing ${runKey}, skipping...`);
      return { success: false, reason: 'already_healing' };
    }

    healingAttempts.current.set(runKey, true);

    try {
      console.log(`🔧 Starting healing process for ${repoFullName}...`);
      
      setHealingInProgress(prev => ({ ...prev, [repoFullName]: true }));
      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          healingInProgress: true,
          lastHealingAttempt: new Date().toISOString(),
          lastAttemptedRunId: failedRun.id // IMMEDIATELY mark as attempted
        }
      }));

      // Step 1: Get workflow logs for analysis
      let workflowLogs = '';
      try {
        workflowLogs = await githubService.getWorkflowLogs(repoFullName, failedRun.id);
        console.log(`📋 Retrieved ${workflowLogs.length} characters of logs`);
      } catch (error) {
        console.warn('Could not fetch workflow logs, proceeding with basic info:', error);
        workflowLogs = `Workflow: ${failedRun.name}\nStatus: ${failedRun.conclusion}\nRun: ${failedRun.html_url}`;
      }

      // Step 2: Analyze failure with Groq
      console.log('🔍 Analyzing failure with AI...');
      const analysis = await groqService.analyzeFailure(workflowLogs, failedRun, repoFullName);
      console.log('✅ Analysis completed:', analysis.issue);
      
      // Step 3: Generate fix instructions
      console.log('🛠️ Generating fix instructions...');
      const fixInstructions = await groqService.generateFixInstructions(analysis, repoFullName);
      console.log('✅ Fix instructions generated');

      // Step 4: Create branch directly via GitHub API
      const branchName = `auto-fix-${failedRun.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
      console.log(`🌿 Creating branch: ${branchName}`);
      await apiService.createBranch(
        repoFullName,
        branchName,
        'main'
      );

      // Step 5: Apply fixes (create or update files)
      console.log('💾 Applying fixes...');
      const filesToFix = fixInstructions.filesToCreateOrModify || [];
      
      for (const file of filesToFix) {
        console.log(`  - Updating ${file.path}`);
        await apiService.createOrUpdateFile(
          repoFullName,
          file.path,
          file.content,
          fixInstructions.commitMessage || `🤖 Auto-fix: ${failedRun.name}`,
          branchName
        );
      }

      // Step 6: Create Pull Request
      console.log('📝 Creating pull request...');
      const prResult = await apiService.createPullRequest(
        repoFullName,
        fixInstructions.prTitle || `🤖 Auto-fix: ${failedRun.name}`,
        fixInstructions.prDescription || `## Automated Fix\n\n**Issue:** ${analysis.issue}\n\n**Solution:** ${analysis.suggestedFix}\n\n**Workflow Run:** ${failedRun.html_url}`,
        branchName,
        'main'
      );

      const prData = {
        id: `${repoFullName}-${Date.now()}`,
        repo: repoFullName,
        title: fixInstructions.prTitle || `🤖 Auto-fix: ${failedRun.name}`,
        url: prResult.data?.html_url || prResult.html_url,
        branch: branchName,
        timestamp: new Date().toISOString(),
        runId: failedRun.id
      };

      // Step 7: Add to recent PRs for UI display
      addRecentPR(prData);

      // Step 8: Send Slack notification
      try {
        await apiService.sendSlackNotification(
          `✅ *Auto-fix Applied*\n` +
          `📦 Repo: ${repoFullName}\n` +
          `🔧 Workflow: ${failedRun.name}\n` +
          `🔗 PR: ${prData.url}\n` +
          `📋 Issue: ${analysis.issue}`
        );
      } catch (slackError) {
        console.warn('Failed to send Slack notification:', slackError);
      }

      // Update monitoring status
      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          healingInProgress: false,
          lastHealingResult: 'success',
          lastFixApplied: new Date().toISOString(),
          prUrl: prData.url,
          fixSummary: analysis.issue,
          lastHealedRunId: failedRun.id // Track which run we healed
        }
      }));

      console.log(`✅ Healing completed for ${repoFullName}!`);
      console.log(`📝 PR: ${prData.url}`);
      
      return { 
        success: true, 
        prData,
        analysis,
        branchName 
      };
      
    } catch (error) {
      console.error(`❌ Error in healing process for ${repoFullName}:`, error);
      
      // Send error notification
      try {
        await apiService.sendSlackNotification(
          `❌ *Auto-fix Failed*\n` +
          `📦 Repo: ${repoFullName}\n` +
          `🔧 Workflow: ${failedRun.name}\n` +
          `⚠️ Error: ${error.message}`
        );
      } catch (slackError) {
        console.warn('Failed to send error notification:', slackError);
      }

      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          healingInProgress: false,
          lastHealingResult: 'failed',
          healingError: error.message,
          lastErrorTime: new Date().toISOString()
        }
      }));
      
      throw error;
    } finally {
      setHealingInProgress(prev => ({ ...prev, [repoFullName]: false }));
      // Keep the attempt in memory for a while to prevent duplicates
      setTimeout(() => {
        healingAttempts.current.delete(runKey);
      }, 300000); // Remove after 5 minutes
    }
  }, [addRecentPR]);

  // Check workflow status with better duplicate detection
  const checkWorkflowStatus = useCallback(async (repoFullName) => {
    try {
      console.log(`🔍 Checking ${repoFullName}...`);

      const workflowRuns = await githubService.getWorkflowRuns(repoFullName);
      const latestRun = workflowRuns[0];
      
      if (!latestRun) {
        console.log(`⚠️ No workflow runs found for ${repoFullName}`);
        return workflowRuns;
      }

      const currentStatus = monitoringStatus[repoFullName];
      const lastRunId = currentStatus?.lastRun?.id;
      
      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          lastCheck: new Date().toISOString(),
          lastRun: {
            id: latestRun.id,
            name: latestRun.name,
            conclusion: latestRun.conclusion,
            status: latestRun.status,
            htmlUrl: latestRun.html_url,
            updatedAt: latestRun.updated_at
          },
          isHealthy: latestRun.conclusion === 'success',
          hasFailures: githubService.hasFailedWorkflow(workflowRuns)
        }
      }));

      // Only trigger healing for NEW failures
      if (githubService.hasFailedWorkflow(workflowRuns) && !healingInProgress[repoFullName]) {
        const failedRun = githubService.getLatestFailedRun(workflowRuns);
        
        if (failedRun && failedRun.id !== lastRunId) {
          console.log(`🚨 NEW workflow failure detected for ${repoFullName}: ${failedRun.name}`);
          
          // Check if we've already attempted to heal this specific run
          const lastHealedRunId = currentStatus?.lastHealedRunId;
          const lastAttemptedRunId = currentStatus?.lastAttemptedRunId;
          
          const shouldHeal = lastHealedRunId !== failedRun.id && 
                           lastAttemptedRunId !== failedRun.id &&
                           !healingAttempts.current.has(`${repoFullName}-${failedRun.id}`);

          if (shouldHeal) {
            console.log(`🔄 Starting healing for run ${failedRun.id}`);
            
            // Immediately update status to prevent duplicates
            setMonitoringStatus(prev => ({
              ...prev,
              [repoFullName]: {
                ...prev[repoFullName],
                lastAttemptedRunId: failedRun.id
              }
            }));
            
            await triggerHealingProcess(repoFullName, failedRun);
          } else {
            console.log(`⏭️ Already attempted to heal run ${failedRun.id}, skipping...`);
          }
        } else if (failedRun && failedRun.id === lastRunId) {
          console.log(`ℹ️ Same failed run detected, no action needed: ${failedRun.id}`);
        }
      } else if (latestRun.conclusion === 'success') {
        console.log(`✅ ${repoFullName} is healthy`);
      }

      return workflowRuns;
    } catch (error) {
      console.error(`Error checking ${repoFullName}:`, error);
      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          lastCheck: new Date().toISOString(),
          error: error.message,
          isHealthy: false
        }
      }));
      throw error;
    }
  }, [healingInProgress, triggerHealingProcess, monitoringStatus]);

  // Start monitoring a repository - SINGLE INSTANCE
  const startMonitoringRepo = useCallback(async (repoFullName) => {
    // Prevent multiple monitoring instances
    if (monitoringIntervals.current[repoFullName]) {
      console.log(`⚠️ Monitoring already active for ${repoFullName}, skipping...`);
      return;
    }

    try {
      console.log(`👁️ Starting monitoring for ${repoFullName}...`);
      
      // Initial check
      await checkWorkflowStatus(repoFullName);
      
      // Set up interval (default 10 minutes)
      const intervalMs = parseInt(process.env.REACT_APP_MONITORING_INTERVAL) || 600000;
      
      const intervalId = setInterval(() => {
        console.log(`⏰ Scheduled check for ${repoFullName}`);
        checkWorkflowStatus(repoFullName);
      }, intervalMs);
      
      monitoringIntervals.current[repoFullName] = intervalId;
      
      setMonitoringStatus(prev => ({
        ...prev,
        [repoFullName]: {
          ...prev[repoFullName],
          monitoringStarted: new Date().toISOString(),
          isActive: true,
          intervalMs: intervalMs
        }
      }));

      console.log(`✅ Monitoring started for ${repoFullName} (checking every ${intervalMs/60000} minutes)`);
    } catch (error) {
      console.error(`Error starting monitoring for ${repoFullName}:`, error);
      throw error;
    }
  }, [checkWorkflowStatus]);

  // Stop monitoring a repository
  const stopMonitoringRepo = useCallback((repoFullName) => {
    if (monitoringIntervals.current[repoFullName]) {
      clearInterval(monitoringIntervals.current[repoFullName]);
      delete monitoringIntervals.current[repoFullName];
      console.log(`🛑 Monitoring stopped for ${repoFullName}`);
    }
    
    setMonitoringStatus(prev => ({
      ...prev,
      [repoFullName]: {
        ...prev[repoFullName],
        isActive: false,
        monitoringStopped: new Date().toISOString()
      }
    }));
  }, []);

  // Toggle monitoring for a repository
  const toggleMonitoring = useCallback(async (repoFullName) => {
    const isCurrentlyMonitored = monitoredRepos.has(repoFullName);
    
    if (isCurrentlyMonitored) {
      stopMonitoringRepo(repoFullName);
      const updated = new Set(monitoredRepos);
      updated.delete(repoFullName);
      setMonitoredRepos(updated);
    } else {
      const updated = new Set(monitoredRepos);
      updated.add(repoFullName);
      setMonitoredRepos(updated);
      await startMonitoringRepo(repoFullName);
    }
  }, [monitoredRepos, startMonitoringRepo, stopMonitoringRepo]);

  // Load monitored repos from localStorage on mount - SINGLE TIME
  useEffect(() => {
    if (isInitialized.current) return; // Prevent multiple initializations
    isInitialized.current = true;

    const saved = localStorage.getItem('monitoredRepos');
    if (saved) {
      try {
        const repos = new Set(JSON.parse(saved));
        setMonitoredRepos(repos);
        console.log(`📂 Loaded ${repos.size} monitored repos from storage`);
        
        // Start monitoring for saved repos with staggered start
        Array.from(repos).forEach((repo, index) => {
          setTimeout(() => {
            startMonitoringRepo(repo).catch(err => 
              console.error(`Failed to start monitoring for ${repo}:`, err)
            );
          }, index * 5000); // Increased stagger to 5 seconds
        });
      } catch (error) {
        console.error('Error loading monitored repos:', error);
      }
    }
  }, [startMonitoringRepo]);

  // Save monitored repos to localStorage when changed
  useEffect(() => {
    localStorage.setItem('monitoredRepos', JSON.stringify([...monitoredRepos]));
    console.log(`💾 Saved ${monitoredRepos.size} monitored repos to storage`);
  }, [monitoredRepos]);

  // Cleanup intervals on unmount
  useEffect(() => {
    const intervals = monitoringIntervals.current;
    return () => {
      Object.values(intervals).forEach(intervalId => {
        clearInterval(intervalId);
      });
      console.log('🧹 Cleaned up all monitoring intervals');
    };
  }, []);

  // Manual check function (for testing)
  const manualCheck = useCallback(async (repoFullName) => {
    console.log(`🔍 Manual check triggered for ${repoFullName}`);
    return await checkWorkflowStatus(repoFullName);
  }, [checkWorkflowStatus]);

  return {
    monitoredRepos,
    monitoringStatus,
    healingInProgress,
    recentPRs, 
    toggleMonitoring,
    startMonitoringRepo,
    stopMonitoringRepo,
    checkWorkflowStatus: manualCheck,
    triggerHealingProcess,
    clearRecentPRs: () => setRecentPRs([]) 
  };
};