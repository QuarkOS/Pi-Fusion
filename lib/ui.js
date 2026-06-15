import chalk from 'chalk';
import ora from 'ora';

/**
 * Terminal UI helper for formatting deliberation stages.
 */
export class TerminalUi {
  constructor() {
    this.spinner = null;
  }

  /**
   * Starts a spinner for a specific stage.
   * @param {string} stage 
   * @param {object} [data] 
   */
  startStage(stage, data = {}) {
    if (this.spinner) {
      this.spinner.stop();
    }

    let text = '';
    switch (stage) {
      case 'panel-start':
        text = chalk.cyan(
          `Tier 1: Running parallel panel expert models (${chalk.green(data.models.technical_expert)}, ${chalk.red(data.models.devils_advocate)}, ${chalk.blue(data.models.systems_thinker)})`
        );
        this.spinner = ora({ text, color: 'cyan' }).start();
        break;
      case 'judge-start':
        text = chalk.magenta(
          `Tier 2: Comparing responses using Deliberation Judge (${chalk.yellow(data.model)})`
        );
        this.spinner = ora({ text, color: 'magenta' }).start();
        break;
      case 'synthesis-start':
        text = chalk.yellow(
          `Tier 3: Generating final grounded synthesis (${chalk.green(data.model)})`
        );
        this.spinner = ora({ text, color: 'yellow' }).start();
        break;
    }
  }

  /**
   * Succeeds the current spinner.
   * @param {string} text 
   */
  succeedStage(text) {
    if (this.spinner) {
      this.spinner.succeed(chalk.gray(text));
      this.spinner = null;
    }
  }

  /**
   * Fails the current spinner.
   * @param {string} text 
   */
  failStage(text) {
    if (this.spinner) {
      this.spinner.fail(chalk.red(text));
      this.spinner = null;
    }
  }

  /**
   * Prints the raw panel expert responses.
   * @param {object} panelResponses 
   */
  printPanelResponses(panelResponses) {
    console.log('\n' + chalk.bold.underline('--- PANEL DELIBERATION RESPONSES ---'));
    
    // Technical Expert
    console.log('\n' + chalk.bold.green('🟢 TECHNICAL EXPERT:'));
    console.log(chalk.gray('========================================'));
    console.log(panelResponses.technical_expert.trim());
    console.log(chalk.gray('========================================'));

    // Devil's Advocate
    console.log('\n' + chalk.bold.red('🔴 DEVIL\'S ADVOCATE:'));
    console.log(chalk.gray('========================================'));
    console.log(panelResponses.devils_advocate.trim());
    console.log(chalk.gray('========================================'));

    // Systems Thinker
    console.log('\n' + chalk.bold.blue('🔵 SYSTEMS THINKER:'));
    console.log(chalk.gray('========================================'));
    console.log(panelResponses.systems_thinker.trim());
    console.log(chalk.gray('========================================'));
    console.log('');
  }

  /**
   * Formats and prints the Judge's structured JSON analysis.
   * @param {object} analysis 
   */
  printJudgeAnalysis(analysis) {
    console.log('\n' + chalk.bold.black.bgWhite('  JUDGE DELIBERATION ANALYSIS  ') + '\n');

    // Consensus
    if (analysis.consensus && analysis.consensus.length > 0) {
      console.log(chalk.bold.green('🤝 Consensus / Agreement:'));
      analysis.consensus.forEach(item => {
        console.log(`  ${chalk.green('✓')} ${item}`);
      });
      console.log('');
    }

    // Contradictions
    if (analysis.contradictions && analysis.contradictions.length > 0) {
      console.log(chalk.bold.red('⚔️ Contradictions / Disputes:'));
      analysis.contradictions.forEach(item => {
        console.log(`  ${chalk.red('✗')} ${item}`);
      });
      console.log('');
    }

    // Partial Coverage
    if (analysis.partial_coverage && analysis.partial_coverage.length > 0) {
      console.log(chalk.bold.yellow('💡 Partial Coverage:'));
      analysis.partial_coverage.forEach(item => {
        console.log(`  ${chalk.yellow('•')} ${item}`);
      });
      console.log('');
    }

    // Unique Insights
    if (analysis.unique_insights && analysis.unique_insights.length > 0) {
      console.log(chalk.bold.magenta('🌟 Unique Insights:'));
      analysis.unique_insights.forEach(item => {
        console.log(`  ${chalk.magenta('★')} ${item}`);
      });
      console.log('');
    }

    // Blind Spots
    if (analysis.blind_spots && analysis.blind_spots.length > 0) {
      console.log(chalk.bold.cyan('🔍 Blind Spots Identified:'));
      analysis.blind_spots.forEach(item => {
        console.log(`  ${chalk.cyan('🔎')} ${item}`);
      });
      console.log('');
    }
  }

  /**
   * Formats and prints markdown content nicely in the terminal.
   * @param {string} text 
   */
  printMarkdown(text) {
    // Basic terminal markdown parser
    let lines = text.split('\n');
    let insideCodeBlock = false;

    const formatted = lines.map(line => {
      // Toggle code blocks
      if (line.trim().startsWith('```')) {
        insideCodeBlock = !insideCodeBlock;
        return chalk.gray('────────────────────────────────────────');
      }

      if (insideCodeBlock) {
        return chalk.bgBlack.gray(`  ${line}`);
      }

      // Headers (e.g. # Header, ## Header)
      if (line.startsWith('# ')) {
        return '\n' + chalk.bold.white.bgBlue(`  ${line.replace('# ', '').toUpperCase()}  `) + '\n';
      }
      if (line.startsWith('## ')) {
        return '\n' + chalk.bold.blue(line.replace('## ', '')) + '\n';
      }
      if (line.startsWith('### ')) {
        return '\n' + chalk.bold.cyan(line.replace('### ', ''));
      }

      // Bold (**text**)
      let formattedLine = line.replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold.yellow(p1));
      
      // Inline code (`code`)
      formattedLine = formattedLine.replace(/`(.*?)`/g, (_, p1) => chalk.cyan(p1));

      // Bullet points
      if (formattedLine.trim().startsWith('- ') || formattedLine.trim().startsWith('* ')) {
        const indent = formattedLine.match(/^\s*/)[0];
        const content = formattedLine.trim().substring(2);
        return `${indent}${chalk.blue('•')} ${content}`;
      }

      return formattedLine;
    }).join('\n');

    console.log(formatted);
  }
}
