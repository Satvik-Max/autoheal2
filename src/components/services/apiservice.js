// frontend/src/services/apiService.js
import { supabase } from '../../lib/supabase';

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

class ApiService {
  constructor() {
    // Normalize base URL (remove trailing slash)
    this.baseUrl = API_BASE_URL?.replace(/\/$/, '') || '';
  }

  async getGitHubToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.debug('Supabase session (ApiService.getGitHubToken):', session);

      const token = session?.provider_token || session?.provider_token?.access_token || session?.access_token || session?.user?.identities?.[0]?.access_token;
      if (!token) {
        throw new Error('No GitHub token available. Please sign in with GitHub.');
      }
      return token;
    } catch (error) {
      console.error('Error getting GitHub token:', error);
      throw error;
    }
  }

  async makeRequest(endpoint, options = {}) {
    try {
      // Get GitHub token for authenticated requests
      const githubToken = await this.getGitHubToken();
      const defaultHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${githubToken}`
      };

      // If endpoint is a full URL, use it as-is; otherwise join with baseUrl
      const url = /^https?:\/\//i.test(endpoint)
        ? endpoint
        : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

      const response = await fetch(url, {
        ...options,
        headers: {
          ...defaultHeaders,
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
    // Create branch directly via GitHub API
    const githubToken = await this.getGitHubToken();
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw new Error('Invalid repoFullName');

    const authHeader = `token ${githubToken}`;

    // Get base branch SHA
    const baseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!baseRes.ok) {
      const t = await baseRes.text();
      throw new Error(`Failed to get base branch: ${baseRes.status} - ${t}`);
    }
    const baseData = await baseRes.json();
    const baseSha = baseData.object?.sha;

    // Create ref
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
    });
    if (!createRes.ok) {
      const t = await createRes.text();
      // If the ref already exists, keep going (branch may have been created previously)
      if (createRes.status === 422 && /Reference already exists/i.test(t)) {
        console.warn(`Branch already exists: ${branchName}`);
        // Return the existing ref info
        const existingRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branchName}`, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
        if (!existingRefRes.ok) {
          const et = await existingRefRes.text();
          throw new Error(`Failed to read existing branch ref: ${existingRefRes.status} - ${et}`);
        }
        return await existingRefRes.json();
      }
      throw new Error(`Failed to create branch: ${createRes.status} - ${t}`);
    }
    return await createRes.json();
  }

  // Create or update file through backend
  async createOrUpdateFile(repoFullName, filePath, content, commitMessage, branch) {
    const githubToken = await this.getGitHubToken();
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw new Error('Invalid repoFullName');
    const authHeader = `token ${githubToken}`;

    // Try to get existing file to obtain SHA
    let sha = null;
    // Preserve path separators when encoding (encode each path segment)
    const safePath = filePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${safePath}?ref=${encodeURIComponent(branch)}`;
    const existingRes = await fetch(getUrl, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
    
    // Safety check: refuse to create new workflow files
    if (!existingRes.ok && filePath.startsWith('.github/workflows')) {
      throw new Error(`Refusing to create new workflow file ${filePath} via API - creation blocked by policy`);
    }
    
    if (existingRes.ok) {
      const existingData = await existingRes.json();
      sha = existingData.sha;
    }

    // Encode content as base64 (browser-friendly)
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${safePath}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, content: base64Content, branch: branch, ...(sha ? { sha } : {}) })
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`Failed to create/update file: ${putRes.status} - ${t}`);
    }
    return await putRes.json();
  }

  // Create pull request through backend
  async createPullRequest(repoFullName, title, body, headBranch, baseBranch = 'main') {
    // Ensure head has commits compared to base (creates marker if needed)
    await this.ensureBranchHasCommits(repoFullName, baseBranch, headBranch);

    const githubToken = await this.getGitHubToken();
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw new Error('Invalid repoFullName');
    const authHeader = `token ${githubToken}`;

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, head: headBranch, base: baseBranch })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Failed to create PR: ${res.status} - ${t}`);
    }
    return await res.json();
  }

  // Get repository content through backend
  async getRepositoryContent(repoFullName, filePath, branch = 'main') {
    const githubToken = await this.getGitHubToken();
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw new Error('Invalid repoFullName');
    const authHeader = `token ${githubToken}`;

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) {
      if (res.status === 404) return null;
      const t = await res.text();
      throw new Error(`Failed to get content: ${res.status} - ${t}`);
    }
    const result = await res.json();
    if (result.content && result.encoding === 'base64') {
      result.decodedContent = decodeURIComponent(escape(atob(result.content)));
    }
    return result;
  }

  // Send Slack notification through backend
  async sendSlackNotification(message) {
    const webhook = process.env.REACT_APP_SLACK_WEBHOOK_URL;
    if (!webhook) {
      throw new Error('No Slack webhook configured (REACT_APP_SLACK_WEBHOOK_URL)');
    }
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Failed to send Slack notification: ${res.status} - ${t}`);
    }
    return await res.text();
  }

  // Trigger auto-healing process
  async triggerAutoHeal(repoFullName, workflowName, errorLogs) {
    // Basic frontend-only auto-heal: create a branch, commit a note, and open a PR
    const branchName = `auto-heal/${Date.now()}`;
    await this.createBranch(repoFullName, branchName);
    const filePath = `auto-heal/${workflowName || 'fix'}-${Date.now()}.log`;
    const commitResult = await this.createOrUpdateFile(repoFullName, filePath, errorLogs || 'Auto-heal triggered', `chore: auto-heal logs for ${workflowName}`, branchName);

    // The GitHub contents PUT response should include a `commit` object when a new commit was created.
    const committedSha = commitResult?.commit?.sha || commitResult?.content?.sha;
    if (!committedSha) {
      // Nothing was committed; avoid creating a PR with no changes
      throw new Error('No changes were committed to the branch; PR will not be created.');
    }

    // Ensure branch actually has commits compared to base before creating PR
    // Default to 'main' as the base branch when not specified
    await this.ensureBranchHasCommits(repoFullName, 'main', branchName);

    const pr = await this.createPullRequest(repoFullName, `Auto-heal: ${workflowName}`, `Auto-heal applied for ${workflowName}`, branchName);
    return pr;
  }

  // Ensure that head branch has at least one commit ahead of base; if identical, create a tiny marker commit
  async ensureBranchHasCommits(repoFullName, baseBranch, headBranch) {
    const githubToken = await this.getGitHubToken();
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw new Error('Invalid repoFullName');
    const authHeader = `token ${githubToken}`;

    const compareUrl = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}`;
    const compareRes = await fetch(compareUrl, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
    if (!compareRes.ok) {
      const t = await compareRes.text();
      throw new Error(`Failed to compare branches: ${compareRes.status} - ${t}`);
    }
    const compareData = await compareRes.json();

    // If branches are identical (no commits on head), create a marker file to force a commit
    if (compareData.status === 'identical') {
      const markerPath = `.auto-heal/marker-${Date.now()}.md`;
      const markerContent = `Auto-heal marker created at ${new Date().toISOString()}`;
      // Use createOrUpdateFile to create the marker on the head branch
      const createRes = await this.createOrUpdateFile(repoFullName, markerPath, markerContent, `chore: add auto-heal marker`, headBranch);

      // Wait for the marker file to be visible via the contents API (GitHub eventual consistency)
      const safeMarkerPath = markerPath.split('/').map(seg => encodeURIComponent(seg)).join('/');
      const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${safeMarkerPath}?ref=${encodeURIComponent(headBranch)}`;
      const maxChecks = 6;
      let found = false;
      for (let attempt = 0; attempt < maxChecks; attempt++) {
        const checkRes = await fetch(contentsUrl, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
        if (checkRes.ok) { found = true; break; }
        // small delay before retrying
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!found) {
        // If the marker file never appeared, include the create result for debugging
        const dbg = createRes || {};
        throw new Error(`Branch is still identical to base after attempting marker commit (marker not visible). Create result: ${JSON.stringify(dbg)}`);
      }

      // Re-run compare to ensure commit exists, retrying a few times for GitHub consistency
      const maxRecompare = 6;
      let recompareData = null;
      for (let attempt = 0; attempt < maxRecompare; attempt++) {
        const recompareRes = await fetch(compareUrl, { headers: { 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' } });
        if (!recompareRes.ok) {
          const t = await recompareRes.text();
          throw new Error(`Failed to re-compare branches after marker commit: ${recompareRes.status} - ${t}`);
        }
        recompareData = await recompareRes.json();
        if (recompareData.status !== 'identical') break;
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!recompareData || recompareData.status === 'identical') {
        throw new Error('Branch is still identical to base after attempting marker commit. PR will not be created.');
      }
    }
    return true;
  }

  // Check service status
  async getStatus() {
    // Simple status: verify GitHub token by fetching authenticated user
    const githubToken = await this.getGitHubToken();
    const res = await fetch('https://api.github.com/user', { headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Status check failed: ${res.status} - ${t}`);
    }
    return await res.json();
  }
}

const apiService = new ApiService();
export default apiService;