import chalk from 'chalk';
import Table from 'cli-table3';
import boxen from 'boxen';
import inquirer from 'inquirer';
import { configStore } from '../config/store';

function list() {
  const conversations = configStore.getConversations();

  if (conversations.length === 0) {
    console.log(chalk.yellow('\n📭 Chưa có lịch sử conversations\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan.bold('ID'),
      chalk.cyan.bold('Title'),
      chalk.cyan.bold('Model'),
      chalk.cyan.bold('Messages'),
      chalk.cyan.bold('Created')
    ],
    colWidths: [15, 40, 25, 12, 20],
    wordWrap: true,
    style: {
      head: [],
      border: ['gray']
    }
  });

  conversations
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(conv => {
      const date = new Date(conv.createdAt).toLocaleString('vi-VN');
      table.push([
        chalk.gray(conv.id),
        chalk.white(conv.title),
        chalk.yellow(conv.model),
        chalk.green(conv.messages.length.toString()),
        chalk.gray(date)
      ]);
    });

  console.log('\n' + table.toString() + '\n');
  console.log(chalk.cyan('💡 Tip: ') + chalk.white('Dùng "openrouter history show <id>" để xem chi tiết\n'));
}

function show(id: string) {
  const conversations = configStore.getConversations();
  const conversation = conversations.find(c => c.id === id);

  if (!conversation) {
    console.log(chalk.red(`\n❌ Không tìm thấy conversation với ID: ${id}\n`));
    return;
  }

  console.log('\n' + boxen(
    chalk.cyan.bold(conversation.title) + '\n' +
    chalk.gray(`Model: ${conversation.model}`) + '\n' +
    chalk.gray(`Created: ${new Date(conversation.createdAt).toLocaleString('vi-VN')}`),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan'
    }
  ));

  conversation.messages.forEach((msg, index) => {
    const isUser = msg.role === 'user';
    const icon = isUser ? '🧑' : '🤖';
    const color = isUser ? chalk.green : chalk.blue;
    const label = isUser ? 'You' : 'Assistant';

    console.log(color.bold(`\n${icon} ${label}:`));
    console.log(chalk.white(msg.content));
  });

  console.log('\n');
}

async function clear() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Bạn có chắc muốn xóa tất cả lịch sử?',
      default: false
    }
  ]);

  if (confirm) {
    configStore.clearConversations();
    console.log(chalk.green('\n✅ Đã xóa tất cả lịch sử\n'));
  } else {
    console.log(chalk.yellow('\n❌ Đã hủy\n'));
  }
}

export const historyCommand = {
  list,
  show,
  clear
};
