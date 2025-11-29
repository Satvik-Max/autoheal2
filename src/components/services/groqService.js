import { supabase } from '../../lib/supabase';

class GroqService {

  async getGitHubToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.provider_token || null;
    } catch (error) {
      console.error('Error getting GitHub token:', error);
      return null;
    }
  }

  // Direct Groq API call (replaces backend analyze-failure)
  async analyzeFailure(logs, failedRun, repoFullName) {
    try {
      if (!process.env.REACT_APP_GROQ_API_KEY) {
        throw new Error('Groq API key missing');
      }

      const minimalPrompt = `
Workflow failed: ${failedRun.name}.
Logs: ${typeof logs === 'string' ? logs.slice(0, 2000) : JSON.stringify(logs).slice(0, 2000)}

Return JSON ONLY:
{
 "issue":"short issue",
 "rootCause":"brief reason",
 "suggestedFix":"simple fix",
 "confidence":"high"
}
      `;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.REACT_APP_GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: minimalPrompt }],
          temperature: 0.1,
          max_tokens: 150,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = await response.json();
      const content = JSON.parse(data.choices[0].message.content);

      return {
        ...content,
        runId: failedRun.id,
        workflowName: failedRun.name,
        repository: repoFullName,
        timestamp: new Date().toISOString(),
        filesToFix: [".github/workflows/ci.yml"]
      };

    } catch (err) {
      console.error("Groq analysis error:", err);
      throw new Error("AI analysis failed");
    }
  }

  // Direct Groq call to generate fixes (replaces backend generate-fix)
  async generateFixInstructions(analysis, repoFullName) {
    try {
      if (!process.env.REACT_APP_GROQ_API_KEY) {
        throw new Error("Groq API key missing");
      }

      const prompt = `
Given this analysis:
${JSON.stringify(analysis)}

Repository: ${repoFullName}

Return JSON ONLY:
{
 "fixSteps": ["step1", "step2"],
 "updatedFiles": ["file paths"],
 "confidence":"high"
}
      `;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.REACT_APP_GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      return JSON.parse((await response.json()).choices[0].message.content);

    } catch (error) {
      console.error("Fix generation error:", error);
      throw new Error("Fix generation failed");
    }
  }

  // Optional: test direct Groq connectivity
  async testConnection() {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          "Authorization": `Bearer ${process.env.REACT_APP_GROQ_API_KEY}`
        }
      });

      if (!response.ok) {
        throw new Error(`Groq service error: ${response.status}`);
      }

      return { status: "ok", message: "Groq API reachable" };

    } catch (error) {
      console.error("Groq test error:", error);
      throw error;
    }
  }
}

const groqServiceInstance = new GroqService();
export default groqServiceInstance;
