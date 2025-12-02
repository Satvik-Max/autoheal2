// services/groqService.js
import Groq from "groq-sdk";

class GroqService {
  constructor() {
    try {
      // Initialize Groq client with API key
      const apiKey = process.env.REACT_APP_GROQ_API_KEY;

      if (!apiKey) {
        console.error('❌ REACT_APP_GROQ_API_KEY is not set in environment variables');
        throw new Error('GROQ_API_KEY is required. Please check your .env file.');
      }

      this.groq = new Groq({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true // Required for browser usage
      });

      console.log('✅ Groq client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Groq client:', error);
      throw error;
    }
  }

  // Get available models (updated list)
  getAvailableModels() {
    return [
      "llama-3.1-8b-instant", // Fast, efficient
      "llama-3.1-70b-versatile", // Powerful, balanced
      "mixtral-8x7b-32768", // Legacy (if still available)
      "gemma2-9b-it" // Alternative option
    ];
  }

  // Get the best available model
  getBestModel() {
    return "llama-3.1-8b-instant"; // Default to fast model
  }

  async generateFixInstructions(analysis, repoFullName, repoContext = {}) {
    // repoContext = { existingWorkflowFiles: [...], dependencyFiles: {path: content}, projectType: 'node' }
    if (!this.groq) {
      throw new Error('Groq client not initialized. Please check your API key.');
    }

    const existingWorkflowFiles = repoContext.existingWorkflowFiles || [];
    const dependencyFiles = repoContext.dependencyFiles || {};
    const projectType = repoContext.projectType || 'unknown';

    // Build a short file-list summary for prompt (do NOT include full file contents for large files unless necessary)
    const workflowListText = existingWorkflowFiles.length ? existingWorkflowFiles.join(', ') : '(none)';
    const depFilesListText = Object.keys(dependencyFiles).length ? Object.keys(dependencyFiles).join(', ') : '(none)';

    // include the actual contents of dependency files (short) — helpful for package.json merging
    const depFilesContentText = Object.entries(dependencyFiles).map(([p, c]) => `FILE: ${p}\n${c.substring(0, 1000)}\n---`).join('\n');

    const prompt = `You are an expert CI/CD repair engine for the GitHub Auto-Heal system.

REPO: ${repoFullName}
PROJECT TYPE: ${projectType}

EXISTING WORKFLOW FILES: ${workflowListText}
EXISTING DEPENDENCY/BUILD FILES: ${depFilesListText}

Dependency file contents (only present files):
${depFilesContentText}

FAILURE: ${analysis.issue}
SUGGESTED_FIX: ${analysis.suggestedFix}

CRITICAL RULES (ENFORCE THESE):
1) DO NOT CREATE NEW FILES. Only modify files that are already present in the repository.
2) DO NOT CREATE new workflow files under .github/workflows. You may only modify one of: ${workflowListText}
3) DO NOT create package.json if it does not exist. If package.json exists, DO NOT replace it entirely. Only propose the minimal changes (dependencies/scripts/devDependencies).
4) Do NOT add any 'npm run test' step unless package.json already contains a "test" script.
5) If the failure is due to an invalid runtime version (e.g., Node 100), modify ONLY the workflow file line for node-version and use a valid version (e.g., 18).
6) Return JSON only, EXACT structure:
{
  "prTitle": "Fix: <short>",
  "prDescription": "<long explanation>",
  "commitMessage": "fix: <short>",
  "filesToCreateOrModify": [
    { "path": "<existing file path>", "content": "<full updated content>" }
  ]
}
7) filesToCreateOrModify must only contain paths that are already in the repo (no new paths).
8) Keep changes minimal — do not reformat or reorder files.
9) Do NOT add install commands inside workflow YAML files. Dependencies should be managed in dependency files.

Now analyze given failure logs and the repo context above and return the minimal valid fix as JSON only.
`;

    const maxRetries = 2;
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        console.log(`🤖 Sending request to Groq API (attempt ${attempt})...`);

        const systemContent = attempt === 1 
          ? "You provide concrete file fixes for GitHub Actions. Always return complete file content in JSON format. Never return empty filesToCreateOrModify array."
          : "STRICT: Do NOT create new files under .github/workflows and do NOT add any dependency installation commands inside workflow YAML. Only modify existing files with minimal changes.";

        const completion = await this.groq.chat.completions.create({
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
          ],
          model: this.getBestModel(),
          temperature: 0.0,
          max_tokens: 2500,
          response_format: { type: "json_object" }
        });

        const response = completion.choices[0]?.message?.content;
        console.log('🔍 Groq raw response:', response);

        if (!response) {
          throw new Error('Empty response from Groq API');
        }

        const result = JSON.parse(response);

        // Validate result structure
        if (!result.filesToCreateOrModify || !Array.isArray(result.filesToCreateOrModify)) {
          throw new Error('Invalid response: missing filesToCreateOrModify array');
        }

        if (result.filesToCreateOrModify.length === 0) {
          throw new Error('No file changes generated by AI');
        }

        // Strict validation for minimal, non-destructive edits.
        // We require that workflow file edits are minimal: at most a few line changes
        // and only allowed to change the node-version line (or similarly targeted fixes).
        const installPattern = /npm install|npm ci|pip install|flutter pub get|go get|cargo install|apt-get install|apk add/mi;

        const workflowFilesMap = repoContext.workflowFiles || {};

        const getChangedLineCount = (orig, prop) => {
          const a = (orig || '').split(/\r?\n/);
          const b = (prop || '').split(/\r?\n/);
          const maxLen = Math.max(a.length, b.length);
          let changed = 0;
          for (let i = 0; i < maxLen; i++) {
            if ((a[i] || '') !== (b[i] || '')) changed++;
          }
          return changed;
        };

        const extractUsesMap = (text) => {
          const map = {};
          const usesRegex = /uses:\s*([^\s@]+)@v?(\d+)/gi;
          let m;
          while ((m = usesRegex.exec(text)) !== null) {
            map[m[1]] = parseInt(m[2], 10);
          }
          return map;
        };

        const sanitizedFiles = [];

        for (const f of result.filesToCreateOrModify) {
          if (!f.path || typeof f.path !== 'string') {
            throw new Error('Invalid file path returned by AI');
          }
          if (!f.content || typeof f.content !== 'string') {
            throw new Error('Invalid file content returned by AI');
          }

          // Disallow new workflow files entirely
          if (f.path.startsWith('.github/workflows') && !existingWorkflowFiles.includes(f.path)) {
            throw new Error(`AI attempted to modify a workflow file not in repo: ${f.path}`);
          }

          // Disallow creation of package.json if it didn't exist
          if (f.path === 'package.json' && !dependencyFiles['package.json']) {
            throw new Error('AI attempted to create package.json when none exists');
          }

          // If this is a workflow file, perform strict minimal-change checks
          let proposed;
          if (f.path.startsWith('.github/workflows')) {
            const original = workflowFilesMap[f.path] || '';
            proposed = f.content;

            // If proposed workflow includes install commands, sanitize by removing
            // the offending lines (do not replace with placeholders). This keeps
            // the YAML intact while ensuring installs are not introduced into
            // workflow YAML. Record a note so it can be surfaced in the PR.
            if (installPattern.test(proposed)) {
              const lines = proposed.split(/\r?\n/);
              const sanitizedLines = [];
              let removedCount = 0;
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (installPattern.test(line)) {
                  // Remove this line (it's an install command). Also try to
                  // remove very nearby continuation lines that are part of the same run block
                  removedCount++;
                  continue;
                }
                sanitizedLines.push(line);
              }

              const newProposed = sanitizedLines.join('\n');

              // If sanitization removed everything, reject
              if (!newProposed.trim()) {
                throw new Error('AI proposed workflow edits but sanitization removed all content; aborting');
              }

              proposed = newProposed;
              // Append a sanitization note so caller can include it in PR description
              result.__sanitizationNotes = result.__sanitizationNotes || [];
              result.__sanitizationNotes.push(`${f.path}: removed ${removedCount} install command line(s) from workflow`);
            }

            // Reject any echo placeholder insertions
            if (/\[Auto-?Heal\]/i.test(proposed)) {
              throw new Error('AI inserted diagnostic placeholder into workflow which is disallowed');
            }

            // Count changed lines — be conservative: allow up to 3 changed lines
            const changed = getChangedLineCount(original, proposed);
            if (changed > 3) {
              // Try to auto-minimize: if the only meaningful change is node-version,
              // apply a targeted replacement of the node-version line(s) in the original
              // and accept that minimal change. This helps when the model returns
              // a reformatted file but the intended fix is a single node-version change.
              const nodeVersionRegex = /(node-?version\s*:\s*['"]?)([^'"\s]+)(['"]?)/i;
              const origMatch = original.match(nodeVersionRegex);
              const propMatch = proposed.match(nodeVersionRegex);
              if (origMatch && propMatch && origMatch[2] !== propMatch[2]) {
                // Replace node-version value in original with the proposed value
                const replaced = original.replace(nodeVersionRegex, `$1${propMatch[2]}$3`);
                const newChanged = getChangedLineCount(original, replaced);
                if (newChanged <= 3) {
                  // accept minimized replacement
                  proposed = replaced;
                  result.__sanitizationNotes = result.__sanitizationNotes || [];
                  result.__sanitizationNotes.push(`${f.path}: minimized changes to only update node-version from '${origMatch[2]}' to '${propMatch[2]}'`);
                } else {
                  throw new Error(`AI made too many changes to workflow ${f.path} (${changed} changed lines). Only minimal edits allowed.`);
                }
              } else {
                throw new Error(`AI made too many changes to workflow ${f.path} (${changed} changed lines). Only minimal edits allowed.`);
              }
            }

            // If there are any changes, ensure they are targeted at node-version only
            if (changed > 0) {
              // Check that at least one changed line mentions node-version
              const nodeVersionRegex = /node-?version\s*:/i;
              const origLines = (original || '').split(/\r?\n/);
              const propLines = (proposed || '').split(/\r?\n/);
              let allowed = true;
              let nodeChangeFound = false;
              const maxLen = Math.max(origLines.length, propLines.length);
              for (let i = 0; i < maxLen; i++) {
                const a = origLines[i] || '';
                const b = propLines[i] || '';
                if (a !== b) {
                  // If changed line is not node-version, disallow
                  if (nodeVersionRegex.test(a) || nodeVersionRegex.test(b)) {
                    nodeChangeFound = true;
                  } else {
                    allowed = false;
                    break;
                  }
                }
              }
              if (!allowed || !nodeChangeFound) {
                throw new Error(`Workflow edits must be minimal and target node-version only for ${f.path}`);
              }

              // Additionally, disallow changing workflow name
              const nameRegex = /^name:\s*(.+)$/mi;
              const origNameMatch = original.match(nameRegex);
              const propNameMatch = proposed.match(nameRegex);
              const origName = origNameMatch ? origNameMatch[1].trim() : null;
              const propName = propNameMatch ? propNameMatch[1].trim() : null;
              if (origName && propName && origName !== propName) {
                throw new Error(`AI attempted to rename workflow name from "${origName}" to "${propName}" which is not allowed`);
              }

              // Ensure action major versions are not changed
              const origUses = extractUsesMap(original);
              const propUses = extractUsesMap(proposed);
              for (const key of Object.keys(origUses)) {
                if (propUses[key] && propUses[key] !== origUses[key]) {
                  throw new Error(`AI changed action major version for ${key} from v${origUses[key]} to v${propUses[key]} which is not allowed`);
                }
              }
            }
          }

          // Passed checks — accept file (use potentially sanitized `proposed` when present)
          sanitizedFiles.push({ path: f.path, content: typeof proposed === 'undefined' ? f.content : proposed });
        }

        // All files validated
        result.filesToCreateOrModify = sanitizedFiles;
        console.log(`✅ Generated ${sanitizedFiles.length} validated file changes`);
        return result;

      } catch (error) {
        lastError = error;
        console.warn(`❗ AI response validation failed (attempt ${attempt}):`, error.message || error);
        
        if (attempt >= maxRetries) {
          break;
        }
        
        console.log('🔁 Retrying with stronger guardrails...');
      }
    }

    // If all attempts failed
    console.error('❌ All attempts to generate safe fix instructions failed:', lastError?.message || lastError);
    
    // Handle model deprecation specifically
    if (lastError?.message?.includes('decommissioned') || lastError?.message?.includes('model_not_found')) {
      console.warn('⚠️ Model deprecated, trying alternative models...');
      return await this.tryAlternativeModels(prompt, 'generateFix');
    }

    throw lastError || new Error('Failed to generate safe fix instructions');
  }

  async analyzeFailure(workflowLogs, failedRun, repoFullName) {
    // Validate Groq client is initialized
    if (!this.groq) {
      throw new Error('Groq client not initialized');
    }

    // Extract key error lines from logs (limit to prevent token issues)
    const keyLogs = workflowLogs.split('\n')
      .filter(line => line.includes('error') || line.includes('Error') || line.includes('failed') || line.includes('Failed'))
      .slice(0, 20)
      .join('\n') || workflowLogs.substring(0, 1000);

    const prompt = `
Analyze workflow failure and identify root cause.

WORKFLOW: ${failedRun.name}
REPO: ${repoFullName}
STATUS: ${failedRun.conclusion}

KEY ERROR LOGS:
${keyLogs}

RETURN JSON:
{
  "issue": "specific error description", 
  "suggestedFix": "concrete action to fix",
  "fixCategory": "deps|perms|config|script|env",
  "detailedAnalysis": "brief analysis of what went wrong"
}

Be concise and specific. Focus on the actual error in the logs.
`;

    try {
      console.log('🤖 Analyzing failure with Groq...');

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You analyze GitHub Actions failures and provide specific root causes and fixes. Be concise and accurate."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: this.getBestModel(),
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('Empty analysis response from Groq');
      }

      const result = JSON.parse(response);
      console.log('✅ Analysis completed:', result.issue);
      return result;

    } catch (error) {
      console.error('❌ Analysis failed:', error);

      // Handle model deprecation specifically
      if (error.message.includes('decommissioned') || error.message.includes('model_not_found')) {
        console.warn('⚠️ Model deprecated, trying alternative models...');
        return await this.tryAlternativeModels(prompt, 'analyze');
      }

      // Return a basic analysis as fallback
      return {
        issue: "Workflow execution failed - analysis unavailable",
        suggestedFix: "Review workflow configuration and check recent changes",
        fixCategory: "config",
        detailedAnalysis: "Unable to analyze logs due to API error"
      };
    }
  }

  // Try alternative models if primary fails
  async tryAlternativeModels(prompt, taskType) {
    const models = this.getAvailableModels();
    const primaryModel = this.getBestModel();

    // Remove primary model from alternatives
    const alternativeModels = models.filter(model => model !== primaryModel);

    for (const model of alternativeModels) {
      try {
        console.log(`🔄 Trying alternative model: ${model}`);

        const completion = await this.groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: taskType === 'generateFix'
                ? "You provide concrete file fixes for GitHub Actions. Always return complete file content in JSON format."
                : "You analyze GitHub Actions failures and provide specific root causes and fixes."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          model: model,
          temperature: 0.1,
          max_tokens: taskType === 'generateFix' ? 3000 : 1500,
          response_format: { type: "json_object" }
        });

        const response = completion.choices[0]?.message?.content;

        if (!response) {
          continue; // Try next model
        }

        const result = JSON.parse(response);

        // Validate the result based on task type
        if (taskType === 'generateFix') {
          if (!result.filesToCreateOrModify || !Array.isArray(result.filesToCreateOrModify) || result.filesToCreateOrModify.length === 0) {
            continue; // Try next model
          }
        }

        console.log(`✅ Success with model: ${model}`);
        return result;

      } catch (error) {
        console.warn(`❌ Model ${model} failed:`, error.message);
        continue; // Try next model
      }
    }

    throw new Error('All available models failed. Please check the Groq console for available models.');
  }

  // Test method to verify service is working
  async testConnection() {
    try {
      console.log('🧪 Testing Groq connection...');

      const testCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: "user",
            content: "Say 'OK' if you're working."
          }
        ],
        model: this.getBestModel(),
        max_tokens: 10
      });

      const response = testCompletion.choices[0]?.message?.content;
      console.log('✅ Groq test response:', response);
      return true;

    } catch (error) {
      console.error('❌ Groq connection test failed:', error);

      // Try alternative models for test
      try {
        await this.tryAlternativeModels("Say 'OK' if you're working.", 'test');
        return true;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  // Method to generate a simple fix for testing
  async generateTestFix() {
    const testAnalysis = {
      issue: "Workflow fails because missing npm install step",
      suggestedFix: "Add npm install step before build command",
      fixCategory: "deps"
    };

    try {
      return await this.generateFixInstructions(testAnalysis, "test/repository");
    } catch (error) {
      console.error('Test fix generation failed:', error);
      throw error;
    }
  }

  // Get current model info
  getModelInfo() {
    return {
      current: this.getBestModel(),
      available: this.getAvailableModels()
    };
  }
}

// Create and export singleton instance
let groqServiceInstance = null;

const getGroqService = () => {
  if (!groqServiceInstance) {
    try {
      groqServiceInstance = new GroqService();
    } catch (error) {
      console.error('Failed to create GroqService instance:', error);
      // Create a mock service for development without API key
      groqServiceInstance = {
        generateFixInstructions: async () => {
          throw new Error('Groq service not available. Please set REACT_APP_GROQ_API_KEY.');
        },
        analyzeFailure: async () => ({
          issue: "Mock analysis - Groq service not configured",
          suggestedFix: "Set REACT_APP_GROQ_API_KEY environment variable",
          fixCategory: "config",
          detailedAnalysis: "Groq API key is required for AI-powered analysis"
        }),
        testConnection: async () => false,
        getModelInfo: () => ({ current: 'none', available: [] })
      };
    }
  }
  return groqServiceInstance;
};

const groqService = getGroqService();
export default groqService;