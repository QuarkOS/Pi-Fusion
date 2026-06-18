/**
 * Multi-model deliberation manager (Panel -> Judge -> Synthesis).
 */
export class Deliberator {
  /**
   * @param {object} params
   * @param {import('./api.js').ApiClient} params.apiClient
   * @param {object} params.config
   */
  constructor({ apiClient, config }) {
    this.api = apiClient;
    this.config = config;
  }

  /**
   * Runs the full deliberation pipeline.
   * @param {string} prompt The user prompt to deliberate on.
   * @param {object} [options] Custom overrides
   * @param {string} [options.provider] Provider name to use (e.g. 'opencode-go', 'openai')
   * @param {function} [options.onProgress] Callback for progress updates: (event, data) => void
   * @param {function} [options.onSynthesisDelta] Called with each synthesis content token as it streams.
   * @returns {Promise<{synthesis: string, judgeAnalysis: object, panelResponses: object, models: object, usage: object}>}
   */
  async deliberate(prompt, options = {}) {
    const providerName = options.provider || this.config.provider || 'opencode-go';
    const providerConfig = this.config.providers[providerName];
    
    if (!providerConfig) {
      throw new Error(`Provider "${providerName}" is not configured.`);
    }

    const models = providerConfig.defaultModels;
    const onProgress = options.onProgress || (() => {});

    // Accumulate real token usage across all 5 LLM calls (3 panel + judge + synthesis).
    const totalUsage = {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    };
    const addUsage = (u) => {
      if (!u) return;
      totalUsage.input += u.input || 0;
      totalUsage.output += u.output || 0;
      totalUsage.cacheRead += u.cacheRead || 0;
      totalUsage.cacheWrite += u.cacheWrite || 0;
      totalUsage.totalTokens += u.totalTokens || 0;
    };

    // ==========================================
    // Tier 1: Panel (Parallel Expert Personas)
    // ==========================================
    onProgress('panel-start', {
      models: {
        technical_expert: models.technical_expert,
        devils_advocate: models.devils_advocate,
        systems_thinker: models.systems_thinker,
      }
    });

    const getTemp = (model, defaultTemp) => model.toLowerCase().includes('kimi') ? 1.0 : defaultTemp;

    const panelPromises = [
      // Technical Expert
      this.api.chatCompletion({
        model: models.technical_expert,
        messages: [
          { role: 'system', content: this.config.panel.technical_expert.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: getTemp(models.technical_expert, 0.5),
      }),

      // Devil's Advocate
      this.api.chatCompletion({
        model: models.devils_advocate,
        messages: [
          { role: 'system', content: this.config.panel.devils_advocate.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: getTemp(models.devils_advocate, 0.8),
      }),

      // Systems Thinker
      this.api.chatCompletion({
        model: models.systems_thinker,
        messages: [
          { role: 'system', content: this.config.panel.systems_thinker.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: getTemp(models.systems_thinker, 0.6),
      })
    ];

    let panelResults;
    try {
      panelResults = await Promise.all(panelPromises);
    } catch (error) {
      throw new Error(`Panel phase failed: ${error.message}`);
    }

    for (const r of panelResults) addUsage(r.usage);
    const panelResponses = {
      technical_expert: panelResults[0].content,
      devils_advocate: panelResults[1].content,
      systems_thinker: panelResults[2].content,
    };

    onProgress('panel-end', { panelResponses });

    // ==========================================
    // Tier 2: Judge (Deliberative Evaluation)
    // ==========================================
    onProgress('judge-start', { model: models.judge });

    const judgePrompt = `Here is the original user query:
"${prompt}"

Here are the responses from the three expert models:

---
TECHNICAL EXPERT RESPONSE:
${panelResponses.technical_expert}

---
DEVIL'S ADVOCATE RESPONSE:
${panelResponses.devils_advocate}

---
SYSTEMS THINKER RESPONSE:
${panelResponses.systems_thinker}
---

Analyze, compare, and contrast these responses according to your system instructions. Output only a valid JSON block containing: consensus, contradictions, partial_coverage, unique_insights, and blind_spots.`;

    let judgeResult;
    try {
      judgeResult = await this.api.chatCompletion({
        model: models.judge,
        messages: [
          { role: 'system', content: this.config.judge.systemPrompt },
          { role: 'user', content: judgePrompt }
        ],
        temperature: getTemp(models.judge, 0.2),
        jsonMode: true,
      });
    } catch (error) {
      throw new Error(`Judge phase failed: ${error.message}`);
    }
    addUsage(judgeResult.usage);
    const judgeRawResponse = judgeResult.content;

    // Parse Judge's JSON
    let judgeAnalysis;
    try {
      // Clean up markdown wrapper block if the model included it despite jsonMode
      let cleanJsonStr = judgeRawResponse.trim();
      if (cleanJsonStr.startsWith('```')) {
        cleanJsonStr = cleanJsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
      }
      judgeAnalysis = JSON.parse(cleanJsonStr);
    } catch (error) {
      // Fail-safe parsing recovery: look for JSON-like brackets
      try {
        const startBracket = judgeRawResponse.indexOf('{');
        const endBracket = judgeRawResponse.lastIndexOf('}');
        if (startBracket >= 0 && endBracket > startBracket) {
          judgeAnalysis = JSON.parse(judgeRawResponse.substring(startBracket, endBracket + 1));
        } else {
          throw error;
        }
      } catch {
        // Fallback JSON in case of absolute failure to parse
        judgeAnalysis = {
          consensus: ["Error parsing Judge output. Raw text collected."],
          contradictions: [],
          partial_coverage: [],
          unique_insights: [judgeRawResponse],
          blind_spots: []
        };
      }
    }

    onProgress('judge-end', { judgeAnalysis });

    // ==========================================
    // Tier 3: Synthesis (Final Grounded Answer)
    // ==========================================
    onProgress('synthesis-start', { model: models.synthesis });

    const synthesisPrompt = `Original user query:
"${prompt}"

Panel Expert Responses:
- Technical Expert:
${panelResponses.technical_expert}

- Devil's Advocate:
${panelResponses.devils_advocate}

- Systems Thinker:
${panelResponses.systems_thinker}

Judge's Structured Deliberation Analysis:
${JSON.stringify(judgeAnalysis, null, 2)}

Provide the final synthesis answer grounded in this deliberation. Remember to structure it professionally with Markdown, resolving contradictions and integrating unique insights.`;

    let synthesisResult;
    try {
      synthesisResult = await this.api.chatCompletion({
        model: models.synthesis,
        messages: [
          { role: 'system', content: this.config.synthesis.systemPrompt },
          { role: 'user', content: synthesisPrompt }
        ],
        temperature: getTemp(models.synthesis, 0.5),
        onDelta: options.onSynthesisDelta,
      });
    } catch (error) {
      throw new Error(`Synthesis phase failed: ${error.message}`);
    }
    addUsage(synthesisResult.usage);
    const synthesis = synthesisResult.content;

    onProgress('synthesis-end', { synthesis });

    return {
      synthesis,
      judgeAnalysis,
      panelResponses,
      models: {
        technical_expert: models.technical_expert,
        devils_advocate: models.devils_advocate,
        systems_thinker: models.systems_thinker,
        judge: models.judge,
        synthesis: models.synthesis,
      },
      usage: totalUsage,
    };
  }
}
