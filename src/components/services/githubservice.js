import { supabase } from '../../lib/supabase';

class GitHubService {
  
  async getGitHubToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.provider_token;
    } catch (error) {
      console.error('Error getting GitHub token:', error);
      return null;
    }
  }

  // Check workflow runs for a repository
  async getWorkflowRuns(repoFullName) {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        throw new Error(`Invalid repository name: ${repoFullName}`);
      }
      
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      return data.workflow_runs || [];
      
    } catch (error) {
      console.error(`Error fetching workflow runs for ${repoFullName}:`, error);
      throw error;
    }
  }

  // Get detailed logs for a specific workflow run
  async getWorkflowLogs(repoFullName, runId) {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        throw new Error(`Invalid repository name: ${repoFullName}`);
      }
      
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `GitHub API error: ${response.status}`);
      }

      const logs = await response.text();
      return logs;
      
    } catch (error) {
      console.error(`Error fetching logs for ${repoFullName} run ${runId}:`, error);
      throw error;
    }
  }

  async getRepositories() {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const response = await fetch('https://api.github.com/user/repos', {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          sort: 'updated',
          per_page: 100,
          affiliation: 'owner,collaborator'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `GitHub API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching repositories:', error);
      throw error;
    }
  }



  // Create branch directly via GitHub API
  async createBranch(repoFullName, branchName, baseBranch = 'main') {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      
      // First get the SHA of the base branch
      const baseResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!baseResponse.ok) {
        throw new Error(`Failed to get base branch: ${baseResponse.status}`);
      }

      const baseData = await baseResponse.json();
      const baseSha = baseData.object.sha;

      // Create new branch
      const branchResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/refs`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: baseSha
          })
        }
      );

      if (!branchResponse.ok) {
        const errorData = await branchResponse.text();
        throw new Error(`Failed to create branch: ${branchResponse.status} - ${errorData}`);
      }

      const result = await branchResponse.json();
      console.log(`✅ Branch created: ${branchName}`);
      return result;

    } catch (error) {
      console.error('Error creating branch:', error);
      throw error;
    }
  }

  // Create or update file directly via GitHub API
  async createOrUpdateFile(repoFullName, filePath, content, commitMessage, branch) {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      
      let sha = null;

      // Try to get existing file to get its SHA
      try {
        const existingResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
          {
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            },
            params: { ref: branch }
          }
        );

        if (existingResponse.ok) {
          const existingData = await existingResponse.json();
          sha = existingData.sha;
        }
      } catch (error) {
        // File doesn't exist, that's fine - we'll create it
      }

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: commitMessage,
            content: Buffer.from(content).toString('base64'),
            branch: branch,
            ...(sha && { sha }) // Include SHA only if updating existing file
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create/update file: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log(`✅ File updated: ${filePath}`);
      return result;

    } catch (error) {
      console.error('Error creating/updating file:', error);
      throw error;
    }
  }

  // Create pull request directly via GitHub API
  async createPullRequest(repoFullName, title, body, headBranch, baseBranch = 'main') {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: title,
            body: body,
            head: headBranch,
            base: baseBranch
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create PR: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log(`✅ Pull request created: ${result.html_url}`);
      return result;

    } catch (error) {
      console.error('Error creating pull request:', error);
      throw error;
    }
  }

  // Get repository content
  async getRepositoryContent(repoFullName, filePath, branch = 'main') {
    try {
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const [owner, repo] = repoFullName.split('/');
      
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          },
          params: { ref: branch }
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null; // File doesn't exist
        }
        throw new Error(`Failed to get content: ${response.status}`);
      }

      const result = await response.json();
      
      // Decode content if it's a file
      if (result.content && result.encoding === 'base64') {
        result.decodedContent = Buffer.from(result.content, 'base64').toString('utf8');
      }
      
      return result;

    } catch (error) {
      console.error('Error getting repository content:', error);
      throw error;
    }
  }

  // Check if latest workflow run failed
  hasFailedWorkflow(workflowRuns) {
    if (!workflowRuns || workflowRuns.length === 0) return false;
    
    const latestRun = workflowRuns[0];
    return latestRun.conclusion === 'failure';
  }

  // Get the latest failed run
  getLatestFailedRun(workflowRuns) {
    if (!workflowRuns) return null;
    return workflowRuns.find(run => run.conclusion === 'failure') || null;
  }
}

const githubServiceInstance = new GitHubService();
export default githubServiceInstance;
