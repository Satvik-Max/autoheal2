// frontend/src/services/apiService.js
import { supabase } from '../../lib/supabase';

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async getGitHubToken() {
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
  }

  async makeRequest(endpoint, options = {}) {
    try {
      // Get GitHub token for authenticated requests
      const githubToken = await this.getGitHubToken();
      
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Create branch through backend
  async createBranch(repoFullName, branchName, baseBranch = 'main') {
    return await this.makeRequest('/api/github/create-branch', {
      method: 'POST',
      body: JSON.stringify({
        repoFullName,
        branchName,
        baseBranch
      })
    });
  }

  // Create or update file through backend
  async createOrUpdateFile(repoFullName, filePath, content, commitMessage, branch) {
    return await this.makeRequest('/api/github/create-or-update-file', {
      method: 'POST',
      body: JSON.stringify({
        repoFullName,
        filePath,
        content,
        commitMessage,
        branch
      })
    });
  }

  // Create pull request through backend
  async createPullRequest(repoFullName, title, body, headBranch, baseBranch = 'main') {
    return await this.makeRequest('/api/github/create-pull-request', {
      method: 'POST',
      body: JSON.stringify({
        repoFullName,
        title,
        body,
        headBranch,
        baseBranch
      })
    });
  }

  // Get repository content through backend
  async getRepositoryContent(repoFullName, filePath, branch = 'main') {
    return await this.makeRequest('/api/github/get-content', {
      method: 'POST',
      body: JSON.stringify({
        repoFullName,
        filePath,
        branch
      })
    });
  }

  // Send Slack notification through backend
  async sendSlackNotification(message) {
    return await this.makeRequest('/api/github/send-slack', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  }

  // Trigger auto-healing process
  async triggerAutoHeal(repoFullName, workflowName, errorLogs) {
    return await this.makeRequest('/api/auto-heal', {
      method: 'POST',
      body: JSON.stringify({
        repoFullName,
        workflowName,
        errorLogs
      })
    });
  }

  // Check service status
  async getStatus() {
    return await this.makeRequest('/api/status', {
      method: 'GET'
    });
  }
}

const apiService = new ApiService();
export default apiService;