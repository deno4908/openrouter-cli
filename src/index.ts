#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import { vimChatCommand } from './commands/vim-chat';
import { splitChatCommand } from './commands/split-chat';
import { editorCommand } from './commands/editor';
import { modelsCommand } from './commands/models';
import { configCommand } from './commands/config';
import { historyCommand } from './commands/history';

const program = new Command();

// Banner
console.log(
  gradient.pastel.multiline(
    figlet.textSync('OpenRouter', {
      font: 'Standard',
      horizontalLayout: 'default'
    })
  )
);

console.log(chalk.cyan.bold('  [=>] CLI cho OpenRouter API\n'));

program
  .name('openrouter')
  .description('CLI đầy đủ tính năng cho OpenRouter API')
  .version('1.0.0');

program
  .command('chat')
  .description('Chat với Vim keybindings (j/k scroll, i insert, ESC normal)')
  .option('-m, --model <model>', 'Chọn model')
  .action(vimChatCommand);

program
  .command('vim')
  .description('Alias for chat')
  .option('-m, --model <model>', 'Chọn model')
  .action(vimChatCommand);

program
  .command('split')
  .description('Split view - 2 chat panels side by side')
  .option('-m, --model <model>', 'Default model')
  .action(splitChatCommand);

program
  .command('edit')
  .description('Terminal code editor with vim keybindings')
  .option('-f, --file <file>', 'File to open')
  .action(editorCommand);

program
  .command('models')
  .description('Xem danh sách models')
  .option('-s, --search <term>', 'Tìm kiếm model')
  .action(modelsCommand);

const config = program.command('config').description('Quản lý cấu hình');

config
  .command('set-key')
  .description('Đặt API key')
  .argument('[key]', 'API key')
  .action(configCommand.setKey);

config
  .command('set-model')
  .description('Đặt model mặc định')
  .argument('[model]', 'Model ID')
  .action(configCommand.setModel);

config
  .command('show')
  .description('Xem cấu hình hiện tại')
  .action(configCommand.show);

const history = program.command('history').description('Quản lý lịch sử');

history
  .command('list')
  .description('Xem lịch sử conversations')
  .action(historyCommand.list);

history
  .command('show <id>')
  .description('Xem chi tiết conversation')
  .action(historyCommand.show);

history
  .command('clear')
  .description('Xóa tất cả lịch sử')
  .action(historyCommand.clear);

program.parse();
