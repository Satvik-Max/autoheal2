import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useMonitoring } from './hooks/useMonitoring';
import githubService from './services/githubservice';
import RagChat from './RagChat';

const Profile = () => {
  const { user, signOut } = useAuth();
  const { 
    monitoredRepos, 
    monitoringStatus, 
    toggleMonitoring,
    healingInProgress,
    recentPRs
  } = useMonitoring();

  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showPRNotifications, setShowPRNotifications] = useState(true);
  const [showChat, setShowChat] = useState(false);

  const [userStats, setUserStats] = useState({
    followers: 0,
    following: 0,
    public_repos: 0,
    bio: '',
    location: '',
    company: ''
  });

  const fetchRepositories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: { session } } = await supabase.auth.getSession();
      const githubToken = session?.provider_token;

      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const repos = await githubService.getRepositories(githubToken);
      setRepositories(repos);
      
    } catch (err) {
      console.error('Error fetching repositories:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleMonitoring = useCallback(async (repoFullName) => {
    try {
      await toggleMonitoring(repoFullName);
    } catch (error) {
      console.error('Error toggling monitoring:', error);
      setError('Failed to update monitoring status. Please try again.');
    }
  }, [toggleMonitoring]);

  const fetchUserStats = useCallback(async () => {
    try {
      const username = user?.user_metadata?.user_name;
      if (!username) return;

      const { data: { session } } = await supabase.auth.getSession();
      const githubToken = session?.provider_token;

      const response = await fetch(`https://api.github.com/users/${username}`, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUserStats({
          followers: userData.followers,
          following: userData.following,
          public_repos: userData.public_repos,
          bio: userData.bio,
          location: userData.location,
          company: userData.company
        });
      }
    } catch (error) {
      console.error('Error fetching user stats:', error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchRepositories();
      fetchUserStats();
    }
  }, [user, fetchRepositories, fetchUserStats]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error.message);
      setError('Failed to sign out. Please try again.');
    }
  };

  const getLanguageColor = (language) => {
    const colors = {
      JavaScript: '#f1e05a',
      TypeScript: '#2b7489',
      Python: '#3572A5',
      Java: '#b07219',
      'C++': '#f34b7d',
      CSS: '#563d7c',
      PHP: '#4F5D95',
      Ruby: '#701516',
      Go: '#00ADD8',
      Rust: '#dea584',
      HTML: '#e34c26',
      Vue: '#41b883',
      React: '#61dafb',
      Shell: '#89e051',
      'C#': '#178600',
    };
    return colors[language] || '#8b5cf6';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'never';
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'today';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  const formatRelativeTime = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const filteredRepos = repositories.filter(repo => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'public') return !repo.private;
    if (activeFilter === 'private') return repo.private;
    return true;
  });

  const getStatusBadge = (repoFullName) => {
    const status = monitoringStatus[repoFullName];
    if (!status) return null;

    if (healingInProgress[repoFullName]) {
      return (
        <div style={styles.healingBadge}>
          <div style={styles.spinnerSmall}></div>
          Healing in progress...
        </div>
      );
    }

    if (status.error) {
      return (
        <div style={styles.errorBadge}>
          Error: {status.error}
        </div>
      );
    }

    if (status.lastRun?.conclusion === 'failure') {
      return (
        <div style={styles.failureBadge}>
          Failed {formatRelativeTime(status.lastRun.updatedAt)}
          {status.lastHealingResult === 'success' && (
            <span style={styles.fixApplied}> • Fix Applied</span>
          )}
        </div>
      );
    } else if (status.lastCheck) {
      return (
        <div style={styles.successBadge}>
          Healthy ({formatRelativeTime(status.lastCheck)})
        </div>
      );
    } else if (status.isActive) {
      return (
        <div style={styles.monitoringBadge}>
          Monitoring active
        </div>
      );
    }
    return null;
  };

  const getMonitoringStats = () => {
    const activeMonitored = Object.values(monitoringStatus).filter(status => status.isActive).length;
    const healthyRepos = Object.values(monitoringStatus).filter(status => status.isHealthy).length;
    const failedRepos = Object.values(monitoringStatus).filter(status => 
      status.lastRun?.conclusion === 'failure'
    ).length;
    const healingNow = Object.values(healingInProgress).filter(Boolean).length;

    return {
      activeMonitored,
      healthyRepos,
      failedRepos,
      healingNow
    };
  };

  const PRNotifications = () => {
    if (!showPRNotifications || recentPRs.length === 0) return null;

    return (
      <div style={styles.prNotifications}>
        <div style={styles.prNotificationsHeader}>
          <h3 style={styles.prNotificationsTitle}>
            Recent Auto-Fixes ({recentPRs.length})
          </h3>
          <button 
            onClick={() => setShowPRNotifications(false)}
            style={styles.closeButton}
          >
            ×
          </button>
        </div>
        <div style={styles.prNotificationsList}>
          {recentPRs.map(pr => (
            <div key={pr.id} style={styles.prNotification}>
              <div style={styles.prHeader}>
                <strong style={styles.repoName}>{pr.repo.split('/')[1]}</strong>
                <span style={styles.prTime}>
                  {formatRelativeTime(pr.timestamp)}
                </span>
              </div>
              <div style={styles.prTitle}>{pr.title}</div>
              <div style={styles.prActions}>
                <a 
                  href={pr.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={styles.prLink}
                >
                  View Pull Request
                </a>
                <span style={styles.prBranch}>{pr.branch}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const MonitoringOverview = () => {
    const stats = getMonitoringStats();
    
    return (
      <div style={styles.monitoringOverview}>
        <h3 style={styles.overviewTitle}>Monitoring Overview</h3>
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>{stats.activeMonitored}</div>
            <div style={styles.statLabel}>Active</div>
          </div>
          <div style={styles.statCard}>
            <div style={{...styles.statNumber, color: '#059669'}}>{stats.healthyRepos}</div>
            <div style={styles.statLabel}>Healthy</div>
          </div>
          <div style={styles.statCard}>
            <div style={{...styles.statNumber, color: '#dc2626'}}>{stats.failedRepos}</div>
            <div style={styles.statLabel}>Failed</div>
          </div>
          <div style={styles.statCard}>
            <div style={{...styles.statNumber, color: '#d97706'}}>{stats.healingNow}</div>
            <div style={styles.statLabel}>Healing</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <PRNotifications />
      
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.logo}>
            <div style={styles.logoIcon}>⚡</div>
            <span style={styles.logoText}>Auto Heal</span>
          </div>
          <div style={styles.headerActions}>
            {recentPRs.length > 0 && (
              <button 
                onClick={() => setShowPRNotifications(!showPRNotifications)}
                style={styles.notificationsButton}
              >
                PRs ({recentPRs.length})
              </button>
            )}
            <button 
              onClick={() => setShowChat(s => !s)} 
              style={{...styles.notificationsButton, backgroundColor: showChat ? '#7c3aed' : '#8b5cf6'}}
            >
              {showChat ? 'Close Chat' : 'Chat'}
            </button>
            <button style={styles.signOutButton} onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

        <RagChat open={showChat} onClose={() => setShowChat(false)} />

      <div style={styles.main}>
        <aside style={styles.sidebar}>
          <div style={styles.profileCard}>
            <div style={styles.avatarContainer}>
              <img 
                src={user?.user_metadata?.avatar_url} 
                alt="Profile" 
                style={styles.avatar}
              />
              <div style={styles.onlineIndicator}></div>
            </div>
            
            <div style={styles.userInfo}>
              <h2 style={styles.username}>{user?.user_metadata?.user_name}</h2>
              <p style={styles.fullname}>{user?.user_metadata?.full_name}</p>
              <p style={styles.bio}>{userStats.bio || 'Passionate developer building amazing things'}</p>
            </div>

            <div style={styles.statsGrid}>
              <div style={styles.statItem}>
                <div style={styles.statNumber}>{userStats.followers}</div>
                <div style={styles.statLabel}>Followers</div>
              </div>
              <div style={styles.statItem}>
                <div style={styles.statNumber}>{userStats.following}</div>
                <div style={styles.statLabel}>Following</div>
              </div>
              <div style={styles.statItem}>
                <div style={styles.statNumber}>{repositories.length}</div>
                <div style={styles.statLabel}>Repos</div>
              </div>
            </div>

            <MonitoringOverview />

            <div style={styles.quickStats}>
              <div style={styles.quickStat}>
                <span style={styles.quickStatLabel}>Monitored:</span>
                <span style={styles.quickStatValue}>{monitoredRepos.size}</span>
              </div>
              <div style={styles.quickStat}>
                <span style={styles.quickStatLabel}>Auto-Fixes:</span>
                <span style={styles.quickStatValue}>{recentPRs.length}</span>
              </div>
            </div>
          </div>
        </aside>

        <main style={styles.content}>
          <div style={styles.contentHeader}>
            <div>
              <h1 style={styles.contentTitle}>My Repositories</h1>
              <p style={styles.contentSubtitle}>
                Select repositories to monitor for workflow failures. Auto-healing will create PRs with fixes.
              </p>
            </div>
            <div style={styles.controls}>
              <div style={styles.filterTabs}>
                {['all', 'public', 'private'].map(filter => (
                  <button
                    key={filter}
                    style={{
                      ...styles.filterTab,
                      ...(activeFilter === filter ? styles.activeFilterTab : {})
                    }}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={styles.loadingState}>
              <div style={styles.spinner}></div>
              <p>Loading your repositories...</p>
            </div>
          ) : error ? (
            <div style={styles.errorState}>
              <div style={styles.errorIcon}>⚠</div>
              <h3>Unable to load repositories</h3>
              <p style={styles.errorMessage}>{error}</p>
              <button 
                style={styles.retryButton}
                onClick={fetchRepositories}
              >
                Try Again
              </button>
            </div>
          ) : filteredRepos.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>📁</div>
              <h3>No repositories found</h3>
              <p>Get started by creating your first repository on GitHub!</p>
            </div>
          ) : (
            <div style={styles.reposGrid}>
              {filteredRepos.map(repo => {
                const isMonitored = monitoredRepos.has(repo.full_name);
                const status = monitoringStatus[repo.full_name];
                
                return (
                  <div key={repo.id} style={styles.repoCard}>
                    <div style={styles.repoHeader}>
                      <div style={styles.repoTitle}>
                        <h3 style={styles.repoName}>
                          <a 
                            href={repo.html_url} 
                            style={styles.repoLink}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {repo.name}
                          </a>
                        </h3>
                        <div style={styles.repoMeta}>
                          {repo.private && (
                            <span style={styles.privateBadge}>Private</span>
                          )}
                          {status?.prUrl && (
                            <a 
                              href={status.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={styles.prBadge}
                            >
                              PR Created
                            </a>
                          )}
                        </div>
                      </div>
                      <div style={styles.repoActions}>
                        <div style={styles.repoStats}>
                          <span style={styles.repoStat}>Stars: {repo.stargazers_count}</span>
                          <span style={styles.repoStat}>Forks: {repo.forks_count}</span>
                        </div>
                        <button
                          onClick={() => handleToggleMonitoring(repo.full_name)}
                          style={{
                            ...styles.monitorButton,
                            ...(isMonitored ? styles.monitoringButton : {})
                          }}
                          disabled={healingInProgress[repo.full_name]}
                        >
                          {isMonitored ? 'Stop Monitoring' : 'Monitor Repo'}
                        </button>
                      </div>
                    </div>
                    
                    {repo.description && (
                      <p style={styles.repoDescription}>{repo.description}</p>
                    )}
                    
                    <div style={styles.repoStatus}>
                      {getStatusBadge(repo.full_name)}
                    </div>
                    
                    <div style={styles.repoFooter}>
                      {repo.language && (
                        <div style={styles.repoLanguage}>
                          <span 
                            style={{
                              ...styles.languageDot,
                              backgroundColor: getLanguageColor(repo.language)
                            }}
                          />
                          {repo.language}
                        </div>
                      )}
                      <span style={styles.repoUpdated}>
                        Updated {formatDate(repo.updated_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#334155',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  header: {
    backgroundColor: 'white',
    borderBottom: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  headerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  logoIcon: { 
    fontSize: '28px',
    animation: 'pulse 2s infinite'
  },
  logoText: {
    fontSize: '24px',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  },
  notificationsButton: {
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  signOutButton: {
    backgroundColor: 'transparent',
    color: '#64748b',
    border: '1px solid #e2e8f0',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '32px 24px',
    display: 'grid',
    gridTemplateColumns: '340px 1fr',
    gap: '32px',
    alignItems: 'start'
  },
  sidebar: { 
    position: 'sticky', 
    top: '100px' 
  },
  profileCard: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '28px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
    border: '1px solid #f1f5f9'
  },
  avatarContainer: {
    position: 'relative',
    width: '96px',
    height: '96px',
    margin: '0 auto 20px'
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '3px solid #f8fafc',
    boxShadow: '0 4px 6px -1px rgba(139, 92, 246, 0.2)'
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: '6px',
    right: '6px',
    width: '14px',
    height: '14px',
    backgroundColor: '#10b981',
    border: '2px solid white',
    borderRadius: '50%'
  },
  userInfo: { 
    textAlign: 'center', 
    marginBottom: '20px' 
  },
  username: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#1e293b',
    margin: '0 0 6px 0',
    lineHeight: '1.2'
  },
  fullname: {
    fontSize: '15px',
    color: '#64748b',
    margin: '0 0 12px 0',
    lineHeight: '1.4'
  },
  bio: {
    fontSize: '14px',
    color: '#64748b',
    lineHeight: '1.5',
    margin: 0
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '16px',
    marginBottom: '20px',
    padding: '20px 0',
    borderTop: '1px solid #f1f5f9',
    borderBottom: '1px solid #f1f5f9'
  },
  statItem: { 
    textAlign: 'center' 
  },
  statNumber: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#8b5cf6',
    marginBottom: '4px',
    lineHeight: '1'
  },
  statLabel: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    lineHeight: '1.2'
  },
  monitoringOverview: {
    marginBottom: '20px'
  },
  overviewTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b',
    margin: '0 0 16px 0',
    textAlign: 'center'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: '10px'
  },
  statCard: {
    textAlign: 'center',
    padding: '14px 8px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  quickStats: {
    padding: '16px',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0'
  },
  quickStat: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  quickStatLabel: {
    fontSize: '14px',
    color: '#64748b'
  },
  quickStatValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#8b5cf6'
  },
  content: { 
    minHeight: '400px' 
  },
  contentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '28px',
    gap: '20px'
  },
  contentTitle: {
    fontSize: '26px',
    fontWeight: '700',
    color: '#1e293b',
    margin: 0,
    lineHeight: '1.2'
  },
  contentSubtitle: {
    fontSize: '15px',
    color: '#64748b',
    margin: '6px 0 0 0',
    maxWidth: '500px',
    lineHeight: '1.5'
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  filterTabs: {
    display: 'flex',
    backgroundColor: '#f1f5f9',
    borderRadius: '10px',
    padding: '4px'
  },
  filterTab: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#64748b',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap'
  },
  activeFilterTab: {
    backgroundColor: 'white',
    color: '#8b5cf6',
    boxShadow: '0 2px 4px rgba(139, 92, 246, 0.1)'
  },
  reposGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
    gap: '20px'
  },
  repoCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '22px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    border: '1px solid #f1f5f9',
    transition: 'all 0.2s ease',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    height: 'fit-content'
  },
  repoHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
    gap: '12px'
  },
  repoTitle: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    flex: 1,
    flexDirection: 'column'
  },
  repoName: {
    margin: 0,
    fontSize: '17px',
    fontWeight: '600',
    color: '#1e293b',
    lineHeight: '1.3'
  },
  repoLink: {
    color: 'inherit',
    textDecoration: 'none',
    transition: 'color 0.2s ease'
  },
  repoMeta: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  privateBadge: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#8b5cf6',
    backgroundColor: '#f8fafc',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid #e2e8f0'
  },
  prBadge: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#059669',
    backgroundColor: '#f0fdf4',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid #bbf7d0',
    textDecoration: 'none'
  },
  repoActions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
    minWidth: 'fit-content'
  },
  repoStats: { 
    display: 'flex', 
    gap: '10px',
    fontSize: '11px'
  },
  repoStat: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '500'
  },
  monitorButton: {
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    backgroundColor: 'white',
    color: '#64748b',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    minWidth: '120px'
  },
  monitoringButton: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderColor: '#fecaca'
  },
  repoDescription: {
    color: '#64748b',
    fontSize: '14px',
    lineHeight: '1.5',
    margin: '0 0 14px 0',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  },
  repoStatus: {
    marginBottom: '14px'
  },
  repoFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    color: '#94a3b8',
    marginTop: 'auto'
  },
  repoLanguage: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: '500'
  },
  languageDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  repoUpdated: { 
    fontSize: '11px', 
    color: '#94a3b8' 
  },
  // Status badges
  healingBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '500',
    color: '#d97706',
    backgroundColor: '#fffbeb',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #fed7aa'
  },
  failureBadge: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #fecaca'
  },
  successBadge: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#059669',
    backgroundColor: '#f0fdf4',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #bbf7d0'
  },
  monitoringBadge: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#2563eb',
    backgroundColor: '#dbeafe',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #93c5fd'
  },
  errorBadge: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#7c2d12',
    backgroundColor: '#fef3c7',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #fcd34d'
  },
  fixApplied: {
    color: '#059669',
    fontWeight: '600'
  },
  // PR Notifications
  prNotifications: {
    position: 'fixed',
    top: '20px',
    right: '20px',
    width: '380px',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
    border: '1px solid #e2e8f0',
    zIndex: 1000,
    maxHeight: '80vh',
    overflow: 'hidden'
  },
  prNotificationsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #f1f5f9',
    backgroundColor: '#f8fafc'
  },
  prNotificationsTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: '#64748b',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  prNotificationsList: {
    maxHeight: '400px',
    overflowY: 'auto'
  },
  prNotification: {
    padding: '16px 20px',
    borderBottom: '1px solid #f1f5f9',
    transition: 'background-color 0.2s ease'
  },
  prHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  repoName: {
    fontSize: '14px',
    color: '#1e293b'
  },
  prTime: {
    fontSize: '12px',
    color: '#64748b'
  },
  prTitle: {
    fontSize: '14px',
    color: '#475569',
    marginBottom: '10px',
    lineHeight: '1.4'
  },
  prActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  prLink: {
    fontSize: '12px',
    color: '#8b5cf6',
    textDecoration: 'none',
    fontWeight: '500'
  },
  prBranch: {
    fontSize: '11px',
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    padding: '3px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace'
  },
  // Loading and error states
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 24px',
    color: '#64748b',
    textAlign: 'center'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #f1f5f9',
    borderTop: '3px solid #8b5cf6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px'
  },
  spinnerSmall: {
    width: '16px',
    height: '16px',
    border: '2px solid #f1f5f9',
    borderTop: '2px solid #d97706',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  errorState: {
    textAlign: 'center',
    padding: '80px 24px',
    color: '#64748b'
  },
  errorIcon: { 
    fontSize: '48px', 
    marginBottom: '16px' 
  },
  errorMessage: {
    color: '#ef4444',
    marginBottom: '16px',
    maxWidth: '400px',
    margin: '0 auto 16px'
  },
  retryButton: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid #8b5cf6',
    backgroundColor: '#8b5cf6',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  emptyState: {
    textAlign: 'center',
    padding: '80px 24px',
    color: '#64748b'
  },
  emptyIcon: {
    fontSize: '64px',
    marginBottom: '16px',
    opacity: 0.5
  }
};

// Add CSS animations
const globalStyles = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.repo-link:hover {
  color: #8b5cf6;
}

.monitor-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.sign-out-button:hover {
  background-color: #f8fafc;
}

.pr-notification:hover {
  background-color: #f8fafc;
}

.notifications-button:hover {
  background-color: #7c3aed;
}

.filter-tab:hover {
  background-color: rgba(139, 92, 246, 0.05);
}
`;

// Inject global styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = globalStyles;
  document.head.appendChild(style);
}

export default Profile;