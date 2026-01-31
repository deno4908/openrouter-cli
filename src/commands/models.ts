import chalk from 'chalk';
import Table from 'cli-table3';
import { createSpinner } from 'nanospinner';
import { openRouterAPI } from '../api/openrouter';

export async function modelsCommand(options: { search?: string }) {
  const spinner = createSpinner('Đang tải danh sách models...').start();

  try {
    let models = await openRouterAPI.getModels();

    if (options.search) {
      const searchTerm = options.search.toLowerCase();
      models = models.filter(m => 
        m.id.toLowerCase().includes(searchTerm) || 
        m.name.toLowerCase().includes(searchTerm)
      );
    }

    spinner.success({ text: chalk.green(`Tìm thấy ${models.length} models`) });

    const table = new Table({
      head: [
        chalk.cyan.bold('Model ID'),
        chalk.cyan.bold('Name'),
        chalk.cyan.bold('Context'),
        chalk.cyan.bold('Price (Prompt)'),
        chalk.cyan.bold('Price (Completion)')
      ],
      colWidths: [35, 30, 12, 18, 20],
      wordWrap: true,
      style: {
        head: [],
        border: ['gray']
      }
    });

    // Show top 20 models
    models.slice(0, 20).forEach(model => {
      table.push([
        chalk.white(model.id),
        chalk.yellow(model.name),
        chalk.gray(model.context_length.toLocaleString()),
        chalk.green(model.pricing.prompt),
        chalk.green(model.pricing.completion)
      ]);
    });

    console.log('\n' + table.toString() + '\n');

    if (models.length > 20) {
      console.log(chalk.gray(`... và ${models.length - 20} models khác\n`));
    }

    console.log(chalk.cyan('💡 Tip: ') + chalk.white('Dùng --search để tìm kiếm model cụ thể\n'));

  } catch (error: any) {
    spinner.error({ text: chalk.red('Lỗi!') });
    console.log(chalk.red(`\n❌ ${error.message}\n`));
    process.exit(1);
  }
}
