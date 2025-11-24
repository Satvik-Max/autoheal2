import { supabase } from '../../lib/supabase';

class GroqService {
  
  async getGitHubToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.provider_token;
    } catch (error) {
      console.error('Error getting GitHub token:', error);
      return null;
    }
  }

  async analyzeFailure(logs, failedRun, repoFullName) {
    try {
      const githubToken = await this.getGitHubToken();
      
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ai/analyze-failure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`
        },
        body: JSON.stringify({
          logs: typeof logs === 'string' ? logs.substring(0, 3000) : JSON.stringify(logs).substring(0, 3000),
          failedRun,
          repoFullName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Analysis failed: ${response.status}`);
      }

      return await response.json();
      
    } catch (error) {
      console.error('Error in Groq analysis:', error);
      throw new Error(`AI analysis failed: ${error.message}`);
    }
  }

  async generateFixInstructions(analysis, repoFullName) {
    try {
      const githubToken = await this.getGitHubToken();
      
      if (!githubToken) {
        throw new Error('No GitHub token available');
      }

      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ai/generate-fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`
        },
        body: JSON.stringify({
          analysis,
          repoFullName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Fix generation failed: ${response.status}`);
      }

      return await response.json();
      
    } catch (error) {
      console.error('Error generating fix instructions:', error);
      throw error;
    }
  }

  // Test connection to backend AI service
  async testConnection() {
    try {
      const githubToken = await this.getGitHubToken();
      
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ai/health`, {
        headers: githubToken ? {
          'Authorization': `Bearer ${githubToken}`
        } : {}
      });
      
      if (!response.ok) {
        throw new Error(`Backend AI service unhealthy: ${response.status}`);
      }

      const health = await response.json();
      return health;
      
    } catch (error) {
      console.error('Error testing AI service connection:', error);
      throw error;
    }
  }
}

const groqServiceInstance = new GroqService();
export default groqServiceInstance;