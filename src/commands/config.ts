import inquirer from 'inquirer';
import chalk from 'chalk';
import boxen from 'boxen';
import { configStore } from '../config/store';

async function setKey(key?: string) {
  let apiKey = key;

  if (!apiKey) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Nhập OpenRouter API key:',
        mask: '*'
      }
    ]);
    apiKey = answer.apiKey;
  }

  if (!apiKey) {
    console.log(chalk.red('\n❌ API key không được để trống\n'));
    return;
  }

  configStore.setApiKey(apiKey);
  console.log(chalk.green('\n✅ API key đã được lưu!\n'));
  console.log(chalk.cyan('💡 Tip: ') + chalk.white('Chạy "openrouter chat" để bắt đầu\n'));
}

async function setModel(model?: string) {
  let selectedModel = model;

  if (!selectedModel) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'model',
        message: 'Nhập model ID:',
        default: 'openai/gpt-3.5-turbo'
      }
    ]);
    selectedModel = answer.model;
  }

  if (!selectedModel) {
    console.log(chalk.red('\n❌ Model không được để trống\n'));
    return;
  }

  configStore.setDefaultModel(selectedModel);
  console.log(chalk.green(`\n✅ Model mặc định: ${selectedModel}\n`));
}

function show() {
  const config = configStore.getAll();
  
  const info = [
    chalk.cyan('API Key: ') + (config.apiKey ? chalk.green('✓ Đã cấu hình') : chalk.red('✗ Chưa cấu hình')),
    chalk.cyan('Default Model: ') + chalk.yellow(config.defaultModel || 'openai/gpt-3.5-turbo'),
    chalk.cyan('Conversations: ') + chalk.white((config.conversations?.length || 0).toString())
  ].join('\n');

  console.log('\n' + boxen(info, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
    title: '⚙️  Configuration',
    titleAlignment: 'center'
  }) + '\n');

  if (!config.apiKey) {
    console.log(chalk.yellow('⚠️  Chạy "openrouter config set-key" để cấu hình API key\n'));
  }
}

export const configCommand = {
  setKey,
  setModel,
  show
};
