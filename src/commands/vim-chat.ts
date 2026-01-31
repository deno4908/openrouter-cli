import blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import clipboard from 'clipboardy';
import { openRouterAPI, FreeModel } from '../api/openrouter';
import { configStore, Conversation } from '../config/store';
import { themes, themeNames, getTheme, Theme } from '../config/themes';
import { splitChatCommand } from './split-chat';
import { editorCommand } from './editor';

// Fallback models if API fails
const FALLBACK_MODELS: FreeModel[] = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', context_length: 128000 },
  { id: 'tngtech/tng-r1t-chimera:free', name: 'TNG: R1T Chimera', context_length: 1000000 },
];

// Check and setup API keys - always show management screen
async function checkApiKeys(): Promise<boolean> {
  return new Promise((resolve) => {
    const screen = blessed.screen({ smartCSR: true, title: 'API Key Management' });

    const box = blessed.box({
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      label: ' API Key Management ',
      border: { type: 'line' },
      style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
      tags: true,
      scrollable: true
    });

    // Load existing keys from .env
    const keys: string[] = [];
    const envKeys = process.env.OPENROUTER_API_KEYS;
    if (envKeys) {
      keys.push(...envKeys.split(',').map(k => k.trim()).filter(k => k));
    }

    function updateContent() {
      let content = keys.length > 0
        ? `{green-fg}API Keys configured: ${keys.length}{/green-fg}\n\n`
        : `{yellow-fg}No API keys found!{/yellow-fg}\n\n`;
      content += `Get your free key at: {cyan-fg}https://openrouter.ai/keys{/cyan-fg}\n\n`;
      content += `{green-fg}Current Keys:{/green-fg}\n`;
      if (keys.length === 0) {
        content += `  (no keys added)\n`;
      } else if (keys.length > 5) {
        content += `  Total: ${keys.length} keys configured\n`;
      } else {
        keys.forEach((k, i) => {
          content += `  ${i + 1}. ${k.slice(0, 15)}...${k.slice(-5)}\n`;
        });
      }
      content += `\n{yellow-fg}Commands:{/yellow-fg}\n`;
      content += `  {cyan-fg}a{/cyan-fg} - Add new key\n`;
      content += `  {cyan-fg}v{/cyan-fg} - Validate all keys\n`;
      content += `  {cyan-fg}d{/cyan-fg} - Delete last key\n`;
      content += `  {green-fg}Enter{/green-fg} - Continue (if keys exist)\n`;
      content += `  {red-fg}q{/red-fg} - Quit\n`;
      box.setContent(content);
      screen.render();
    }

    screen.append(box);
    box.focus();
    updateContent();

    screen.key(['a'], () => {
      const inputBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        label: ' Enter API Key(s) - comma separated ',
        border: { type: 'line' },
        style: { border: { fg: 'cyan' }, fg: 'white' },
        inputOnFocus: true
      });
      screen.append(inputBox);
      inputBox.focus();
      inputBox.readInput();
      screen.render();

      inputBox.on('submit', (value: string) => {
        screen.remove(inputBox);
        if (value && value.trim()) {
          // Support multiple keys separated by comma
          const newKeys = value.split(',').map(k => k.trim()).filter(k => k);
          keys.push(...newKeys);
        }
        box.focus();
        updateContent();
      });

      inputBox.on('cancel', () => {
        screen.remove(inputBox);
        box.focus();
        updateContent();
      });
    });

    screen.key(['v'], async () => {
      if (keys.length === 0) {
        box.setContent(box.getContent() + '\n{red-fg}No keys to validate!{/red-fg}');
        screen.render();
        return;
      }

      box.setContent(box.getContent() + `\n{yellow-fg}Validating ${keys.length} keys in parallel...{/yellow-fg}`);
      screen.render();

      // Parallel validation using Promise.all
      const results = await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/models', {
              headers: { 'Authorization': `Bearer ${key}` }
            });
            return res.ok ? key : null;
          } catch {
            return null;
          }
        })
      );

      const validKeys = results.filter((k): k is string => k !== null);
      keys.length = 0;
      keys.push(...validKeys);
      box.setContent('');
      updateContent();
      box.setContent(box.getContent() + `\n{green-fg}Valid keys: ${validKeys.length}{/green-fg}`);
      screen.render();
    });

    screen.key(['d'], () => {
      if (keys.length > 0) {
        keys.pop();
        updateContent();
      }
    });

    screen.key(['enter'], () => {
      if (keys.length > 0) {
        // Save keys to .env
        const envPath = path.join(process.cwd(), '.env');
        const envContent = `OPENROUTER_API_KEYS=${keys.join(',')}`;
        fs.writeFileSync(envPath, envContent);
        process.env.OPENROUTER_API_KEYS = keys.join(',');
        screen.destroy();
        resolve(true);
      }
    });

    screen.key(['q', 'C-c'], () => {
      screen.destroy();
      resolve(false);
    });
  });
}

let cachedModels: FreeModel[] = [];

async function loadModels(): Promise<FreeModel[]> {
  if (cachedModels.length > 0) return cachedModels;

  const models = await openRouterAPI.getFreeModels();
  cachedModels = models.length > 0 ? models : FALLBACK_MODELS;
  return cachedModels;
}

function selectModelSync(screen: blessed.Widgets.Screen, chatBox: blessed.Widgets.BoxElement, models: FreeModel[], currentModel: string): Promise<string> {
  return new Promise((resolve) => {
    let selectedIndex = models.findIndex(m => m.id === currentModel);
    if (selectedIndex < 0) selectedIndex = 0;

    const visibleHeight = Math.min(models.length + 2, 18);

    const overlay = blessed.box({
      top: 'center',
      left: 'center',
      width: 60,
      height: visibleHeight,
      label: ' Select Model (j/k, Enter=select, ESC=cancel) ',
      border: { type: 'line' },
      style: { border: { fg: 'yellow' }, bg: 'black' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: '|' }
    });
    let scrollTop = 0;
    const contentHeight = visibleHeight - 2; // minus border

    function renderList() {
      let content = '';
      models.forEach((m, i) => {
        const prefix = i === selectedIndex ? '{cyan-bg}{black-fg} > ' : '   ';
        const suffix = i === selectedIndex ? ' {/black-fg}{/cyan-bg}' : '';
        const current = m.id === currentModel ? ' (current)' : '';
        content += `${prefix}${m.name}${current}${suffix}\n`;
      });
      overlay.setContent(content);

      // Auto-scroll to keep selection visible (scroll line by line)
      if (selectedIndex < scrollTop) {
        scrollTop = selectedIndex;
      } else if (selectedIndex >= scrollTop + contentHeight) {
        scrollTop = selectedIndex - contentHeight + 1;
      }
      overlay.scrollTo(scrollTop);
      screen.render();
    }

    screen.append(overlay);
    overlay.focus();
    renderList();

    let done = false;

    const handleJ = () => {
      if (done) return;
      selectedIndex = Math.min(selectedIndex + 1, models.length - 1);
      renderList();
    };

    const handleK = () => {
      if (done) return;
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderList();
    };

    const handleEnter = () => {
      if (done) return;
      finish(models[selectedIndex].id);
    };

    const handleEscape = () => {
      if (done) return;
      finish(currentModel);
    };

    function finish(result: string) {
      if (done) return;
      done = true;
      // Remove all key handlers first
      screen.unkey('j', handleJ);
      screen.unkey('k', handleK);
      screen.unkey('down', handleJ);
      screen.unkey('up', handleK);
      screen.unkey('enter', handleEnter);
      screen.unkey('escape', handleEscape);
      // Remove overlay from screen
      screen.remove(overlay);
      screen.render();
      resolve(result);
    }

    // Bind keys
    screen.key('j', handleJ);
    screen.key('k', handleK);
    screen.key('down', handleJ);
    screen.key('up', handleK);
    screen.key('enter', handleEnter);
    screen.key('escape', handleEscape);
  });
}

async function selectModel(models: FreeModel[]): Promise<string> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true  // Support Vietnamese
    });

    const list = blessed.list({
      top: 'center',
      left: 'center',
      width: 60,
      height: Math.min(models.length + 4, 20),
      label: ' Select Model ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'cyan', fg: 'black' }
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      items: models.map(m => m.name)
    });

    screen.append(list);
    list.focus();

    list.on('select', (_, index) => {
      screen.destroy();
      resolve(models[index].id);
    });

    screen.key(['q', 'escape'], () => {
      screen.destroy();
      resolve(models[0].id);
    });

    screen.key(['C-c'], () => process.exit(0));
    screen.render();
  });
}

async function selectConversation(): Promise<Conversation | null> {
  const conversations = configStore.getConversations();

  // Sort by pinned first, then by updatedAt descending
  conversations.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  // Limit to 10 most recent
  const recentConversations = conversations.slice(0, 10);

  if (recentConversations.length === 0) {
    return null; // No saved conversations
  }

  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true
    });

    const items = [
      '[ + New Chat ]',
      ...recentConversations.map((c, i) => {
        const date = new Date(c.updatedAt).toLocaleDateString();
        const msgCount = c.messages.length;
        const title = c.title.slice(0, 35);
        const pin = c.pinned ? '[*] ' : '';
        return `${i + 1}. ${pin}${title} (${msgCount} msgs, ${date})`;
      })
    ];

    const overlay = blessed.box({
      top: 'center',
      left: 'center',
      width: 70,
      height: Math.min(items.length + 4, 16),
      label: ' j/k=nav Enter=open d=del p=pin t=rename o=fork n=new ',
      border: { type: 'line' },
      style: { border: { fg: 'cyan' }, bg: 'black' },
      tags: true
    });

    let selectedIndex = 0;

    function renderList() {
      let content = '';
      items.forEach((item, i) => {
        const prefix = i === selectedIndex ? '{cyan-bg}{black-fg} > ' : '   ';
        const suffix = i === selectedIndex ? ' {/black-fg}{/cyan-bg}' : '';
        content += `${prefix}${item}${suffix}\n`;
      });
      overlay.setContent(content);
      screen.render();
    }

    screen.append(overlay);
    overlay.focus();
    renderList();

    const handleJ = () => {
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      renderList();
    };

    const handleK = () => {
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderList();
    };

    const handleEnter = () => {
      screen.destroy();
      if (selectedIndex === 0) {
        resolve(null); // New chat
      } else {
        resolve(recentConversations[selectedIndex - 1]);
      }
    };

    const handleN = () => {
      screen.destroy();
      resolve(null); // New chat
    };

    const handleDelete = () => {
      // Cannot delete "New Chat" option
      if (selectedIndex === 0) return;

      const convToDelete = recentConversations[selectedIndex - 1];

      // Delete from config store
      configStore.deleteConversation(convToDelete.id);

      // Remove from local lists
      recentConversations.splice(selectedIndex - 1, 1);
      items.splice(selectedIndex, 1);

      // Update overlay height
      overlay.height = Math.min(items.length + 4, 16);

      // Adjust selection
      if (selectedIndex >= items.length) {
        selectedIndex = Math.max(0, items.length - 1);
      }

      // If no more conversations, go to new chat
      if (recentConversations.length === 0) {
        screen.destroy();
        resolve(null);
        return;
      }

      renderList();
    };

    const handlePin = () => {
      if (selectedIndex === 0) return;
      const conv = recentConversations[selectedIndex - 1];
      conv.pinned = !conv.pinned;
      configStore.saveConversation(conv);
      // Update display
      const date = new Date(conv.updatedAt).toLocaleDateString();
      const msgCount = conv.messages.length;
      const title = conv.title.slice(0, 35);
      const pin = conv.pinned ? '[*] ' : '';
      items[selectedIndex] = `${selectedIndex}. ${pin}${title} (${msgCount} msgs, ${date})`;
      renderList();
    };

    const handleRename = () => {
      if (selectedIndex === 0) return;
      const conv = recentConversations[selectedIndex - 1];

      const renameBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        label: ' Rename (Enter=save, Esc=cancel) ',
        border: { type: 'line' },
        style: { border: { fg: 'green' }, bg: 'black', fg: 'white' },
        inputOnFocus: true
      });

      screen.append(renameBox);
      renameBox.focus();
      renameBox.setValue(conv.title);
      screen.render();

      renameBox.key(['enter'], () => {
        const newTitle = renameBox.getValue().trim();
        if (newTitle) {
          conv.title = newTitle;
          configStore.saveConversation(conv);
          const date = new Date(conv.updatedAt).toLocaleDateString();
          const msgCount = conv.messages.length;
          const pin = conv.pinned ? '[*] ' : '';
          items[selectedIndex] = `${selectedIndex}. ${pin}${newTitle.slice(0, 35)} (${msgCount} msgs, ${date})`;
        }
        screen.remove(renameBox);
        overlay.focus();
        renderList();
      });

      renameBox.key(['escape'], () => {
        screen.remove(renameBox);
        overlay.focus();
        renderList();
      });
    };

    const handleFork = () => {
      if (selectedIndex === 0) return;
      const conv = recentConversations[selectedIndex - 1];
      const forkedConv: Conversation = {
        id: Date.now().toString(),
        title: `${conv.title} (fork)`,
        model: conv.model,
        systemPrompt: conv.systemPrompt,
        messages: [...conv.messages],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      configStore.saveConversation(forkedConv);
      recentConversations.unshift(forkedConv);
      const date = new Date(forkedConv.updatedAt).toLocaleDateString();
      const msgCount = forkedConv.messages.length;
      items.splice(1, 0, `1. ${forkedConv.title.slice(0, 35)} (${msgCount} msgs, ${date})`);
      // Re-number items
      for (let i = 2; i < items.length; i++) {
        const old = items[i];
        items[i] = old.replace(/^\d+\./, `${i}.`);
      }
      overlay.height = Math.min(items.length + 4, 16);
      renderList();
    };

    screen.key('j', handleJ);
    screen.key('k', handleK);
    screen.key('down', handleJ);
    screen.key('up', handleK);
    screen.key('enter', handleEnter);
    screen.key('n', handleN);
    screen.key('d', handleDelete);
    screen.key('p', handlePin);
    screen.key('t', handleRename);
    screen.key('o', handleFork);
    screen.key('escape', handleN);
    screen.key(['C-c'], () => process.exit(0));
  });
}

export async function vimChatCommand(options: { model?: string, conversation?: Conversation, termux?: boolean }) {
  // Clear console
  console.clear();

  // Check for API keys first
  const hasKeys = await checkApiKeys();
  if (!hasKeys) {
    console.log('No API keys configured. Exiting.');
    process.exit(0);
  }

  // Load theme
  let currentTheme = getTheme(configStore.getTheme());

  // Load models from API
  const models = await loadModels();

  let model: string;
  let conversation: Conversation;

  // If conversation is passed, use it directly (e.g., returning from split mode)
  if (options.conversation) {
    conversation = options.conversation;
    model = options.conversation.model;
  } else {
    // Check for existing conversations first
    const existingConversation = await selectConversation();

    if (existingConversation) {
      // Continue existing conversation
      conversation = existingConversation;
      model = existingConversation.model;
    } else {
      // New conversation - select model first
      model = options.model || await selectModel(models);
      conversation = {
        id: Date.now().toString(),
        title: 'New Chat',
        model,
        systemPrompt: '', // Reset to empty for new conversation
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: 'OpenRouter Chat',
    fullUnicode: true  // Support Vietnamese characters
  });

  // Detect Termux (Android terminal) or forced via --termux flag
  const isTermux = options.termux === true ||
    process.env.TERMUX_VERSION !== undefined ||
    process.env.PREFIX?.includes('com.termux') ||
    process.platform === 'android';

  const chatBox = blessed.box({
    top: 0,
    left: 0,
    width: '80%',
    height: '100%-5',
    label: ' Chat ',
    border: { type: 'line' },
    style: {
      border: { fg: currentTheme.border },
      label: { fg: 'cyan' }
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '|' },
    mouse: true,
    keys: false, // Disable to prevent conflict with workspace
    vi: false,   // Disable to prevent conflict with workspace
    tags: true
  });

  const helpBox = blessed.box({
    top: 0,
    right: 0,
    width: '20%',
    height: '100%-5',
    label: ' Shortcuts ',
    border: { type: 'line' },
    style: {
      border: { fg: currentTheme.border },
      label: { fg: 'magenta' },
      focus: { border: { fg: 'yellow' } }
    },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    scrollbar: { ch: '|', style: { fg: 'cyan' } },
    keys: true,
    content: `{yellow-fg}Normal:{/yellow-fg}
 {cyan-fg}i{/cyan-fg} Insert
 {cyan-fg}j/k{/cyan-fg} Scroll
 {cyan-fg}G/g{/cyan-fg} Bot/Top

{yellow-fg}Chat:{/yellow-fg}
 {green-fg}r{/green-fg} Regen
 {green-fg}y{/green-fg} Copy
 {cyan-fg}/{/cyan-fg} Search
 {cyan-fg}x{/cyan-fg} Clear

{yellow-fg}Manage:{/yellow-fg}
 {cyan-fg}t{/cyan-fg} Rename
 {magenta-fg}p{/magenta-fg} Pin
 {magenta-fg}o{/magenta-fg} Fork
 {cyan-fg}d/D{/cyan-fg} Delete

{yellow-fg}Files:{/yellow-fg}
 {magenta-fg}C-o{/magenta-fg} Browse
 {magenta-fg}C-f{/magenta-fg} Attach
 {cyan-fg}e{/cyan-fg} Editor

{yellow-fg}Term:{/yellow-fg}
 {magenta-fg}M-t{/magenta-fg} Open
 {cyan-fg}C-d{/cyan-fg} cd

{yellow-fg}System:{/yellow-fg}
 {cyan-fg}m{/cyan-fg} Model
 {green-fg}S-h{/green-fg} History
 {cyan-fg}C-s{/cyan-fg} Split
 {magenta-fg}C-t{/magenta-fg} Theme
 {magenta-fg}C-b{/magenta-fg} Back
 {red-fg}q/C-c{/red-fg} Quit

{yellow-fg}Tab{/yellow-fg} Focus this`
  });

  // Tab to toggle focus between chatBox and helpBox
  let helpFocused = false;
  screen.key(['tab'], () => {
    if (mode !== 'normal' || editorOpen) return;
    helpFocused = !helpFocused;
    if (helpFocused) {
      helpBox.focus();
      helpBox.style.border.fg = 'yellow';
    } else {
      chatBox.focus();
      helpBox.style.border.fg = currentTheme.border;
    }
    screen.render();
  });

  // Scroll helpBox with j/k when focused
  helpBox.key(['j', 'down'], () => { helpBox.scroll(1); screen.render(); });
  helpBox.key(['k', 'up'], () => { helpBox.scroll(-1); screen.render(); });

  const inputBox = blessed.textbox({
    bottom: 1,
    left: 0,
    width: '100%',
    height: 3,
    label: ' Input ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: currentTheme.border },
      label: { fg: 'yellow' },
      focus: {
        fg: 'white',
        bg: 'black',
        border: { fg: currentTheme.borderFocus }
      }
    },
    inputOnFocus: true
  });

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: `[NORMAL] Model: ${model}`,
    style: { fg: currentTheme.status.fg, bg: currentTheme.status.bg }
  });

  screen.append(chatBox);
  screen.append(helpBox);
  screen.append(inputBox);
  screen.append(statusBar);

  // On Termux, focus inputBox immediately to trigger keyboard
  // and set mode to 'insert' to prevent screen.key handlers from intercepting
  if (isTermux) {
    inputBox.focus();
    inputBox.readInput();
  }

  // Re-render on every keypress to show typed text and fix cursor position
  inputBox.on('keypress', () => {
    // Use setTimeout to ensure cursor position is updated after the key is processed
    setTimeout(() => {
      screen.render();
    }, 0);
  });

  // On Termux, start in insert mode since inputBox is already focused
  let mode: 'normal' | 'insert' = isTermux ? 'insert' : 'normal';
  let editorOpen = false; // Track when editor is open
  let attachedFile: string | null = null; // Attached file content
  let attachedFileName: string | null = null; // Attached file name

  // Strip emojis that display incorrectly in terminal
  function stripEmoji(text: string): string {
    // Comprehensive emoji removal including all common ranges
    return text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '');
  }

  // Helper to compact file content for display
  function compactFileContent(content: string): string {
    // Match [File: filename]\n```...```\n pattern and replace with compact version
    return content.replace(/\[File: ([^\]]+)\]\n```[\s\S]*?```\n\n(User message: )?/g, '[Attached: $1] ');
  }

  // Initialize chat content - load history if continuing conversation
  let chatContent = '';
  if (conversation.messages.length > 0) {
    chatContent += `[Continuing: ${conversation.title}]\n\n`;
    for (const msg of conversation.messages) {
      const cleanContent = stripEmoji(compactFileContent(msg.content));
      if (msg.role === 'user') {
        chatContent += `You: ${cleanContent}\n\n`;
      } else {
        chatContent += `{cyan-fg}AI: ${cleanContent}{/cyan-fg}\n\n`;
      }
    }
  } else {
    chatContent = `Loaded ${models.length} free models. Press i to type, m to change model.\n\n`;
  }
  chatBox.setContent(chatContent);
  chatBox.setScrollPerc(100);

  function getModelName(id: string): string {
    const m = models.find(x => x.id === id);
    return m ? m.name : id.split('/').pop() || id;
  }

  function updateStatus() {
    statusBar.setContent(`[${mode.toUpperCase()}] Model: ${getModelName(model)} | Msgs: ${conversation.messages.length}`);
    statusBar.style.bg = mode === 'insert' ? 'yellow' : 'cyan';
    screen.render();
  }

  function addMessage(role: 'user' | 'assistant', content: string, isError: boolean = false) {
    const cleanContent = stripEmoji(content);
    if (role === 'user') {
      chatContent += `You: ${cleanContent}\n\n`;
    } else if (isError) {
      chatContent += `{red-fg}AI: ${cleanContent}{/red-fg}\n\n`;
    } else {
      chatContent += `{cyan-fg}AI: ${cleanContent}{/cyan-fg}\n\n`;
    }
    chatBox.setContent(chatContent);
    chatBox.setScrollPerc(100);
    screen.render();
  }

  async function sendMessage() {
    const message = inputBox.getValue().trim();
    if (!message) return;

    inputBox.setValue('');

    const CHUNK_SIZE = 4000; // 4K characters per chunk

    // Handle large attached files - split into chunks
    if (attachedFile && attachedFileName) {
      const ext = attachedFileName.split('.').pop() || 'txt';
      const fileContent = attachedFile;
      const totalLength = fileContent.length;

      if (totalLength > CHUNK_SIZE) {
        // Large file - split into chunks
        const totalChunks = Math.ceil(totalLength / CHUNK_SIZE);

        // Show single notification
        addMessage('user', `[Attaching: ${attachedFileName} (${totalChunks} chunks)]`);
        chatContent += `{yellow-fg}[Sending large file in ${totalChunks} chunks...]{/yellow-fg}\n\n`;
        chatBox.setContent(chatContent);
        chatBox.setScrollPerc(100);
        screen.render();

        // Send each chunk
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const chunkContent = fileContent.slice(start, start + CHUNK_SIZE);
          const chunkMessage = `[File: ${attachedFileName}] [Chunk ${i + 1}/${totalChunks}]\n\`\`\`${ext}\n${chunkContent}\n\`\`\`\n${i === totalChunks - 1 ? `\nUser message: ${message}` : '\n(Continue sending next chunk...)'}`;

          // Update status
          statusBar.setContent(`Sending chunk ${i + 1}/${totalChunks}...`);
          screen.render();

          conversation.messages.push({
            role: 'user',
            content: chunkMessage,
            timestamp: Date.now()
          });

          // For first chunks, just send without waiting for response
          if (i < totalChunks - 1) {
            // Send chunk silently, AI will just acknowledge
            try {
              const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
              apiMessages.push({ role: 'system', content: 'IMPORTANT: Never use emojis, icons, emoticons, or special symbols. User is sending a large file in chunks. Just respond "Received chunk X/Y" briefly.' });
              if (conversation.systemPrompt) {
                apiMessages.push({ role: 'system', content: conversation.systemPrompt });
              }
              apiMessages.push({ role: 'user', content: chunkMessage });

              let ack = '';
              for await (const chunk of openRouterAPI.chatStream(apiMessages, model)) {
                ack += chunk;
              }
              conversation.messages.push({
                role: 'assistant',
                content: ack || `Received chunk ${i + 1}/${totalChunks}`,
                timestamp: Date.now()
              });
            } catch (e) {
              // Continue even if chunk fails
            }
          }
        }

        // Clear attachment
        attachedFile = null;
        attachedFileName = null;

        // Last chunk - get full response
        try {
          let response = '';
          chatContent += '{cyan-fg}AI: ';
          chatBox.setContent(chatContent + '...{/cyan-fg}');
          screen.render();

          const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
          apiMessages.push({ role: 'system', content: 'CRITICAL RULE: You MUST NOT use any emojis, emoticons, icons, or special unicode symbols (like 😀, ✨, 🎉, etc.) in your responses. Use only plain ASCII text. Khong duoc su dung emoji.' });

          if (conversation.systemPrompt) {
            apiMessages.push({ role: 'system', content: conversation.systemPrompt });
          }

          // Add all conversation messages including chunks
          apiMessages.push(...conversation.messages.map(m => ({
            role: m.role,
            content: m.content
          })));

          for await (const chunk of openRouterAPI.chatStream(apiMessages, model)) {
            response += chunk;
            chatBox.setContent(chatContent + response + '{/cyan-fg}');
            chatBox.setScrollPerc(100);
            screen.render();
          }

          if (!response) {
            response = '(No response from API)';
          }

          chatContent += response + `{/cyan-fg}\n\n`;

          conversation.messages.push({
            role: 'assistant',
            content: response,
            timestamp: Date.now()
          });

          conversation.updatedAt = Date.now();
          configStore.saveConversation(conversation);
        } catch (error: any) {
          chatContent += `{red-fg}AI: Error - ${error.message}{/red-fg}\n\n`;
        }

        chatBox.setContent(chatContent);
        updateStatus();
        screen.render();
        return;
      }
    }

    // Normal message (or small attached file)
    let fullMessage = message;
    if (attachedFile && attachedFileName) {
      const ext = attachedFileName.split('.').pop() || 'txt';
      fullMessage = `[File: ${attachedFileName}]\n\`\`\`${ext}\n${attachedFile}\n\`\`\`\n\nUser message: ${message}`;
      // Clear attachment after use
      attachedFile = null;
      attachedFileName = null;
    }

    addMessage('user', message); // Show original message in chat

    conversation.messages.push({
      role: 'user',
      content: fullMessage, // Send full message with file to API
      timestamp: Date.now()
    });

    if (conversation.messages.length === 1) {
      conversation.title = message.slice(0, 50);
    }

    try {
      let response = '';
      chatContent += '{cyan-fg}AI: ';
      chatBox.setContent(chatContent + '...{/cyan-fg}');
      screen.render();

      const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];

      // Add base system prompt to avoid emojis
      apiMessages.push({ role: 'system', content: 'CRITICAL RULE: You MUST NOT use any emojis, emoticons, icons, or special unicode symbols (like 😀, ✨, 🎉, etc.) in your responses. Use only plain ASCII text. Khong duoc su dung emoji.' });

      // Add user's custom system prompt if set
      if (conversation.systemPrompt) {
        apiMessages.push({ role: 'system', content: conversation.systemPrompt });
      }

      // Add history context from previous conversations if enabled
      if (configStore.getHistoryEnabled()) {
        const historyContext = configStore.getRecentMessagesContext(conversation.id);
        if (historyContext) {
          apiMessages.push({
            role: 'system',
            content: `Previous conversation context:\n${historyContext}`
          });
        }
      }

      // Add conversation messages with reminders in last user message
      const messagesWithReminder = conversation.messages.map((m, i) => {
        if (m.role === 'user' && i === conversation.messages.length - 1) {
          // Anti-emoji is ALWAYS present
          let reminder = '\n\n[Do not use emojis in your response]';
          // System prompt is OPTIONAL - add separately if exists
          if (conversation.systemPrompt) {
            reminder += `\n[System instructions: ${conversation.systemPrompt}]`;
          }
          return {
            role: m.role,
            content: m.content + reminder
          };
        }
        return { role: m.role, content: m.content };
      });
      apiMessages.push(...messagesWithReminder);

      // Show message count in status for debugging
      statusBar.setContent(`Sending ${apiMessages.length} messages to API...`);
      screen.render();

      for await (const chunk of openRouterAPI.chatStream(apiMessages, model)) {
        response += chunk;
        chatBox.setContent(chatContent + response + '{/cyan-fg}');
        chatBox.setScrollPerc(100);
        screen.render();
      }

      if (!response) {
        response = '(No response from API)';
      }

      chatContent += response + `{/cyan-fg}\n\n`;

      conversation.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      });

      conversation.updatedAt = Date.now();
      configStore.saveConversation(conversation);
    } catch (error: any) {
      chatContent += `{red-fg}AI: Error - ${error.message}{/red-fg}\n\n`;
    }

    chatBox.setContent(chatContent);
    screen.render();
  }

  // Regenerate response (call API with existing messages)
  async function regenerateResponse() {
    try {
      let response = '';
      chatContent += '{cyan-fg}AI: ';
      chatBox.setContent(chatContent + '...{/cyan-fg}');
      screen.render();

      const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];

      if (conversation.systemPrompt) {
        apiMessages.push({ role: 'system', content: conversation.systemPrompt });
      }

      apiMessages.push(...conversation.messages.map(m => ({
        role: m.role,
        content: m.content
      })));

      for await (const chunk of openRouterAPI.chatStream(apiMessages, model)) {
        response += chunk;
        chatBox.setContent(chatContent + response + '{/cyan-fg}');
        chatBox.setScrollPerc(100);
        screen.render();
      }

      if (!response) {
        response = '(No response from API)';
      }

      chatContent += response + `{/cyan-fg}\n\n`;

      conversation.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      });

      conversation.updatedAt = Date.now();
      configStore.saveConversation(conversation);
    } catch (error: any) {
      chatContent += `{red-fg}AI: Error - ${error.message}{/red-fg}\n\n`;
    }

    chatBox.setContent(chatContent);
    screen.render();
  }

  // Key bindings
  let workspaceOpen = false; // Moved here so all handlers can access
  let overlayOpen = false; // Track when any overlay (model selector, etc) is open
  let wsFocused = true; // true = workspace focused, false = chat/editor focused
  let loadFileInEditor: ((filePath: string, fileName: string) => void) | null = null;
  let activeWorkspaceBox: any = null; // Reference for cleanup
  let activeWsKeyHandler: any = null; // Reference for cleanup

  screen.key(['i'], () => {
    // On Termux, inputBox is always focused so skip this handler
    // to prevent double character input
    if (isTermux) return;

    if (mode === 'normal' && !editorOpen) {
      mode = 'insert';
      inputBox.focus();
      inputBox.readInput();
      updateStatus();
      screen.render();
    }
  });

  // Scroll with j/k and arrow keys in normal mode
  screen.key(['j', 'down'], () => {
    if (mode === 'normal' && !workspaceOpen && !overlayOpen) {
      chatBox.scroll(1);
      screen.render();
    }
  });

  screen.key(['k', 'up'], () => {
    if (mode === 'normal' && !workspaceOpen && !overlayOpen) {
      chatBox.scroll(-1);
      screen.render();
    }
  });

  screen.key(['G'], () => {
    if (mode === 'normal' && !editorOpen) {
      chatBox.setScrollPerc(100);
      screen.render();
    }
  });

  screen.key(['g'], () => {
    if (mode === 'normal' && !editorOpen) {
      chatBox.setScrollPerc(0);
      screen.render();
    }
  });


  screen.key(['escape'], () => {
    if (mode === 'insert') {
      mode = 'normal';
      // On Termux, keep inputBox focused to keep keyboard open
      if (!isTermux) {
        chatBox.focus();
      }
      updateStatus();
    }
  });

  inputBox.key(['escape'], () => {
    mode = 'normal';
    // On Termux, keep inputBox focused to keep keyboard open
    if (!isTermux) {
      chatBox.focus();
    }
    updateStatus();
  });

  inputBox.key(['enter'], async () => {
    if (mode === 'insert') {
      await sendMessage();
      inputBox.cancel();
      mode = 'normal';
      chatBox.focus();
      updateStatus();
    }
  });

  // Shift+h to toggle history context
  screen.key(['S-h'], () => {
    if (mode === 'normal' && !editorOpen) {
      const enabled = !configStore.getHistoryEnabled();
      configStore.setHistoryEnabled(enabled);
      const status = enabled ? '{green-fg}ON{/green-fg}' : '{red-fg}OFF{/red-fg}';
      chatContent += `[History context: ${status}]\n\n`;
      chatBox.setContent(chatContent);
      chatBox.setScrollPerc(100);
      screen.render();
    }
  });

  screen.key(['m'], async () => {
    if (mode === 'normal' && !editorOpen) {
      overlayOpen = true; // Prevent chat scroll while model selector is open
      const previousModel = model;
      model = await selectModelSync(screen, chatBox, models, model);
      overlayOpen = false;

      if (model !== previousModel) {
        conversation.model = model;
        chatContent += `[Model changed to: ${getModelName(model)}]\n\n`;
        chatBox.setContent(chatContent);
      }

      setTimeout(() => {
        chatBox.focus();
        updateStatus();
        screen.render();
      }, 10);
    }
  });

  // Alt+T: Open embedded terminal
  screen.key(['M-t'], () => {
    const { spawn } = require('child_process');
    let terminalOutput = '';

    // Container for entire terminal overlay
    const termContainer = blessed.box({
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      border: { type: 'line' },
      style: { border: { fg: 'magenta' } },
      label: ' Terminal (Enter=run, Esc=close, j/k=scroll) '
    });

    // Output area (scrollable) - inside container
    const termBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-5',
      parent: termContainer,
      style: { fg: 'white' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,  // Enable mouse wheel scrolling
      scrollbar: { ch: '█', style: { fg: 'magenta' } }
    });

    // Command input - at bottom of container
    const cmdInput = blessed.textbox({
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 3,
      parent: termContainer,
      label: ' Command ',
      border: { type: 'line' },
      style: { border: { fg: 'cyan' }, fg: 'white' },
      inputOnFocus: true
    });

    screen.append(termContainer);
    cmdInput.focus();
    screen.render();

    // Current working directory for terminal
    let termCwd = process.cwd();

    const runCommand = (cmd: string) => {
      terminalOutput += `{cyan-fg}$ ${cmd}{/cyan-fg}\n`;
      termBox.setContent(terminalOutput + '{gray-fg}Running...{/gray-fg}');
      screen.render();

      const { exec } = require('child_process');

      exec(cmd, {
        cwd: termCwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10
      }, (error: any, stdout: string, stderr: string) => {
        if (stdout) {
          terminalOutput += stdout;
        }
        if (stderr) {
          terminalOutput += `{red-fg}${stderr}{/red-fg}`;
        }
        if (error && !stdout && !stderr) {
          terminalOutput += `{red-fg}Error: ${error.message}{/red-fg}\n`;
        }
        const exitCode = error ? error.code || 1 : 0;
        terminalOutput += `{gray-fg}[Exit: ${exitCode}]{/gray-fg}\n\n`;
        termBox.setContent(terminalOutput);
        termBox.setScrollPerc(100);
        cmdInput.clearValue();
        cmdInput.focus();
        (screen as any).alloc();
        screen.render();
      });
    };

    cmdInput.key(['enter'], () => {
      const cmd = cmdInput.getValue().trim();
      if (cmd) {
        runCommand(cmd);
      }
      cmdInput.clearValue();
      cmdInput.focus();
      screen.render();
    });


    // Close terminal with ESC
    cmdInput.key(['escape'], () => {
      screen.remove(termContainer);
      chatBox.focus();
      updateStatus();
    });

    // Ctrl+D: Open folder browser to cd
    cmdInput.key(['C-d'], () => {
      let browseDir = termCwd;

      const showDirBrowser = () => {
        const entries: { name: string, isDir: boolean }[] = [];
        entries.push({ name: '..', isDir: true });

        try {
          const items = fs.readdirSync(browseDir);
          for (const item of items) {
            try {
              const stat = fs.statSync(path.join(browseDir, item));
              if (stat.isDirectory() && !item.startsWith('.')) {
                entries.push({ name: item, isDir: true });
              }
            } catch { }
          }
        } catch { }

        const dirList = blessed.list({
          top: 'center',
          left: 'center',
          width: '60%',
          height: '50%',
          label: ` CD: ${browseDir} (j/k=nav, Enter=select, q/Esc=close) `,
          border: { type: 'line' },
          style: {
            border: { fg: 'yellow' },
            selected: { bg: 'yellow', fg: 'black' },
            item: { fg: 'white' }
          },
          keys: false,
          vi: false,
          mouse: true,
          interactive: true,
          items: ['[SELECT THIS DIR]', ...entries.map(e => `[DIR] ${e.name}`)]
        });

        screen.append(dirList);
        (cmdInput as any).cancel();
        dirList.focus();
        dirList.select(0);
        screen.render();

        // Use screen keypress handler for navigation
        const dirKeyHandler = (_ch: string, key: any) => {
          if (!key) return;

          if (key.name === 'j' || key.name === 'down') {
            dirList.down(1);
            screen.render();
          } else if (key.name === 'k' || key.name === 'up') {
            dirList.up(1);
            screen.render();
          } else if (key.name === 'enter') {
            const idx = (dirList as any).selected as number;

            if (idx === 0) {
              termCwd = browseDir;
              terminalOutput += `{yellow-fg}> cd ${termCwd}{/yellow-fg}\n`;
              termBox.setContent(terminalOutput);
              screen.removeListener('keypress', dirKeyHandler);
              screen.remove(dirList);
              cmdInput.focus();
              screen.render();
            } else {
              const entry = entries[idx - 1];
              screen.removeListener('keypress', dirKeyHandler);
              screen.remove(dirList);
              if (entry.name === '..') {
                browseDir = path.dirname(browseDir);
              } else {
                browseDir = path.join(browseDir, entry.name);
              }
              showDirBrowser();
            }
          } else if (key.name === 'escape' || key.name === 'q') {
            screen.removeListener('keypress', dirKeyHandler);
            screen.remove(dirList);
            cmdInput.focus();
            screen.render();
          }
        };

        screen.on('keypress', dirKeyHandler);
      };

      showDirBrowser();
    });
  });

  // Workspace box (Ctrl+O) - VS Code style command palette
  screen.key(['C-o'], () => {
    // Cleanup existing workspace if any
    if (workspaceOpen && activeWorkspaceBox) {
      screen.remove(activeWorkspaceBox);
      if (activeWsKeyHandler) {
        screen.removeListener('keypress', activeWsKeyHandler);
      }
    }
    workspaceOpen = true;

    let currentPath = process.cwd();

    const workspaceBox = blessed.list({
      top: 0,
      right: 0,
      width: '20%',
      height: editorOpen ? '100%-2' : '100%-5',
      label: ' Workspace ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'cyan', fg: 'black' },
        item: { fg: 'white' }
      },
      tags: true,
      keys: true
    });

    const loadWorkspace = () => {
      try {
        const entries = fs.readdirSync(currentPath);
        const items: string[] = ['{yellow-fg}[..] Parent{/yellow-fg}'];

        // Folders first
        for (const e of entries) {
          try {
            if (fs.statSync(path.join(currentPath, e)).isDirectory() && !e.startsWith('.')) {
              items.push(`{cyan-fg}[DIR]{/cyan-fg} ${e}`);
            }
          } catch { }
        }
        // Then files
        for (const e of entries) {
          try {
            if (fs.statSync(path.join(currentPath, e)).isFile() && !e.startsWith('.')) {
              items.push(`{green-fg}[FILE]{/green-fg} ${e}`);
            }
          } catch { }
        }

        workspaceBox.setItems(items);
        workspaceBox.setLabel(` ${path.basename(currentPath) || currentPath} `);
        workspaceBox.select(0);
      } catch {
        workspaceBox.setItems(['{yellow-fg}[..] Parent{/yellow-fg}']);
      }
      screen.render();
    };

    helpBox.hide();
    screen.append(workspaceBox);
    loadWorkspace();
    wsFocused = true; // Reset focus when opening workspace

    const wsKeyHandler = (ch: string, key: any) => {
      if (!workspaceOpen || !key) return;

      if (key.name === 'tab') {
        wsFocused = !wsFocused;
        (workspaceBox as any).interactive = wsFocused; // Toggle key capture
        workspaceBox.setLabel(wsFocused ?
          ` {cyan-fg}Workspace{/cyan-fg} ` :
          ` {gray-fg}Workspace{/gray-fg} (Tab=focus) `);
        screen.render();
        return;
      }

      if (key.name === 'j' || key.name === 'down') {
        if (wsFocused) {
          workspaceBox.down(1);
          screen.render();
          return; // Stop propagation to editor
        } else if (!editorOpen) {
          chatBox.scroll(1);
          screen.render();
        }
        // If editorOpen and !wsFocused, let editor handle it
      } else if (key.name === 'k' || key.name === 'up') {
        if (wsFocused) {
          workspaceBox.up(1);
          screen.render();
          return; // Stop propagation to editor
        } else if (!editorOpen) {
          chatBox.scroll(-1);
          screen.render();
        }
        // If editorOpen and !wsFocused, let editor handle it;
      } else if (key.name === 'enter' && wsFocused) {
        const idx = (workspaceBox as any).selected;
        const items = (workspaceBox as any).items;
        const itemEl = items[idx];
        const selected = itemEl?.content || itemEl?.getText?.() || '';

        if (idx === 0) {
          // Parent
          currentPath = path.dirname(currentPath);
          loadWorkspace();
        } else if (selected.includes('[DIR]')) {
          const name = selected.replace('{cyan-fg}[DIR]{/cyan-fg} ', '').replace(/\{[^}]+\}/g, '');
          currentPath = path.join(currentPath, name);
          loadWorkspace();
        } else if (selected.includes('[FILE]')) {
          const name = selected.replace('{green-fg}[FILE]{/green-fg} ', '').replace(/\{[^}]+\}/g, '');
          const filePath = path.join(currentPath, name);

          if (!editorOpen) {
            // In chat mode - attach file (don't close workspace)
            try {
              attachedFile = fs.readFileSync(filePath, 'utf-8');
              attachedFileName = name;
              const sizeInfo = attachedFile.length > 4000 ? ` (${Math.ceil(attachedFile.length / 4000)} chunks)` : ` (${attachedFile.length} chars)`;
              chatContent += `{yellow-fg}[Attached: ${name}${sizeInfo}]{/yellow-fg}\n\n`;
              chatBox.setContent(chatContent);
              chatBox.setScrollPerc(100);
            } catch (err) {
              chatContent += `{red-fg}[Error reading file: ${name}]{/red-fg}\n\n`;
              chatBox.setContent(chatContent);
            }
          } else if (loadFileInEditor) {
            // In editor mode - load file for editing, switch focus to editor
            loadFileInEditor(filePath, name);
            wsFocused = false;
            (workspaceBox as any).interactive = false; // Disable keys capture
            workspaceBox.setLabel(` {gray-fg}Workspace{/gray-fg} (Tab=focus) `);
          }
          screen.render();
        }
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'o')) {
        workspaceOpen = false;
        screen.removeListener('keypress', wsKeyHandler);
        screen.remove(workspaceBox);
        activeWorkspaceBox = null;
        activeWsKeyHandler = null;
        helpBox.show();
        screen.render();
      } else if (key.name === 'h' && wsFocused) {
        currentPath = path.dirname(currentPath);
        loadWorkspace();
      }
    };

    // Save references for cleanup
    activeWorkspaceBox = workspaceBox;
    activeWsKeyHandler = wsKeyHandler;
    screen.on('keypress', wsKeyHandler);
  });

  screen.key(['q'], () => {
    if (mode === 'normal' && !editorOpen) {
      process.exit(0);
    }
  });

  screen.key(['d'], () => {
    if (mode === 'normal' && !editorOpen && conversation.messages.length > 0) {
      configStore.deleteConversation(conversation.id);
      chatContent = '[Conversation deleted. Start a new one or press q to quit]\n\n';
      conversation.messages = [];
      chatBox.setContent(chatContent);
      updateStatus();
      screen.render();
    }
  });

  screen.key(['D'], () => {
    if (mode === 'normal' && !editorOpen) {
      configStore.clearConversations();
      chatContent = '[All chat history cleared]\n\n';
      conversation.messages = [];
      chatBox.setContent(chatContent);
      updateStatus();
      screen.render();
    }
  });
  screen.key(['x'], () => {
    if (mode === 'normal' && !editorOpen) {
      if (conversation.messages.length === 0) {
        chatContent += `{yellow-fg}[No messages to export]{/yellow-fg}\n\n`;
        chatBox.setContent(chatContent);
        screen.render();
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `chat-${timestamp}.md`;
      const exportDir = path.join(os.homedir(), 'openrouter-exports');

      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      let md = `# ${conversation.title}\n\n`;
      md += `**Model:** ${conversation.model}\n`;
      md += `**Date:** ${new Date().toLocaleString()}\n\n`;
      if (conversation.systemPrompt) {
        md += `**System Prompt:** ${conversation.systemPrompt}\n\n`;
      }
      md += `---\n\n`;

      for (const msg of conversation.messages) {
        const prefix = msg.role === 'user' ? '## 👤 You' : '## 🤖 AI';
        md += `${prefix}\n\n${msg.content}\n\n`;
      }

      const filepath = path.join(exportDir, filename);
      fs.writeFileSync(filepath, md);

      chatContent += `{green-fg}[Exported to: ${filepath}]{/green-fg}\n\n`;
      chatBox.setContent(chatContent);
      screen.render();
    }
  });

  // Regenerate last response (r)
  screen.key(['r'], async () => {
    if (mode === 'normal' && !editorOpen && conversation.messages.length >= 2) {
      // Remove last AI response
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      if (lastMsg.role === 'assistant') {
        conversation.messages.pop();
        chatContent = '';
        for (const msg of conversation.messages) {
          addMessage(msg.role as 'user' | 'assistant', msg.content);
        }
        chatContent += '{yellow-fg}[Regenerating...]{/yellow-fg}\n\n';
        chatBox.setContent(chatContent);
        screen.render();
        await regenerateResponse();
      }
    }
  });

  // Edit last user message (e)
  screen.key(['e'], () => {
    if (mode === 'normal' && !editorOpen) {
      // Find last user message
      let lastUserIdx = -1;
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        if (conversation.messages[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return;

      const editBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '80%',
        height: 3,
        label: ' Edit message (Enter=save, Esc=cancel) ',
        border: { type: 'line' },
        style: { border: { fg: 'yellow' }, bg: 'black', fg: 'white' },
        inputOnFocus: true
      });

      screen.append(editBox);
      editBox.focus();
      editBox.setValue(conversation.messages[lastUserIdx].content);
      screen.render();

      editBox.key(['enter'], async () => {
        const newContent = editBox.getValue().trim();
        if (newContent) {
          // Remove messages from lastUserIdx onwards
          conversation.messages = conversation.messages.slice(0, lastUserIdx);
          conversation.messages.push({ role: 'user', content: newContent, timestamp: Date.now() });

          // Rebuild chat content
          chatContent = '';
          for (const msg of conversation.messages) {
            addMessage(msg.role as 'user' | 'assistant', msg.content);
          }

          screen.remove(editBox);
          chatBox.focus();
          chatBox.setContent(chatContent);
          screen.render();

          // Get new response
          await regenerateResponse();
        }
      });

      editBox.key(['escape'], () => {
        screen.remove(editBox);
        chatBox.focus();
        screen.render();
      });
    }
  });

  // Yank/Copy last AI response (y)
  screen.key(['y'], async () => {
    if (mode === 'normal' && !editorOpen) {
      // Find last AI message
      let lastAI = null;
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        if (conversation.messages[i].role === 'assistant') {
          lastAI = conversation.messages[i];
          break;
        }
      }
      if (lastAI) {
        try {
          await clipboard.write(lastAI.content);
          chatContent += '{green-fg}[Copied to clipboard]{/green-fg}\n\n';
        } catch {
          chatContent += '{red-fg}[Failed to copy]{/red-fg}\n\n';
        }
        chatBox.setContent(chatContent);
        screen.render();
      }
    }
  });

  // Search in chat (/)
  screen.key(['/'], () => {
    if (mode === 'normal' && !editorOpen) {
      const searchBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        label: ' Search (Enter=find, Esc=cancel) ',
        border: { type: 'line' },
        style: { border: { fg: 'cyan' }, bg: 'black', fg: 'white' },
        inputOnFocus: true
      });

      screen.append(searchBox);
      searchBox.focus();
      screen.render();

      searchBox.key(['enter'], () => {
        const query = searchBox.getValue().trim().toLowerCase();
        screen.remove(searchBox);
        chatBox.focus();

        if (query) {
          const results: string[] = [];
          conversation.messages.forEach((msg, i) => {
            if (msg.content.toLowerCase().includes(query)) {
              const preview = msg.content.substring(0, 50).replace(/\n/g, ' ');
              results.push(`[${i + 1}] ${msg.role}: ${preview}...`);
            }
          });

          if (results.length > 0) {
            chatContent += `{cyan-fg}[Found ${results.length} matches for "${query}"]{/cyan-fg}\n`;
            results.forEach(r => chatContent += `  ${r}\n`);
            chatContent += '\n';
          } else {
            chatContent += `{yellow-fg}[No matches for "${query}"]{/yellow-fg}\n\n`;
          }
          chatBox.setContent(chatContent);
        }
        screen.render();
      });

      searchBox.key(['escape'], () => {
        screen.remove(searchBox);
        chatBox.focus();
        screen.render();
      });
    }
  });

  // Rename conversation (t)
  screen.key(['t'], () => {
    if (mode === 'normal' && !editorOpen) {
      const renameBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        label: ' Rename chat (Enter=save, Esc=cancel) ',
        border: { type: 'line' },
        style: { border: { fg: 'green' }, bg: 'black', fg: 'white' },
        inputOnFocus: true
      });

      screen.append(renameBox);
      renameBox.focus();
      renameBox.setValue(conversation.title);
      screen.render();

      renameBox.key(['enter'], () => {
        const newTitle = renameBox.getValue().trim();
        if (newTitle) {
          conversation.title = newTitle;
          configStore.saveConversation(conversation);
          chatContent += `{green-fg}[Renamed to: ${newTitle}]{/green-fg}\n\n`;
          chatBox.setContent(chatContent);
        }
        screen.remove(renameBox);
        chatBox.focus();
        screen.render();
      });

      renameBox.key(['escape'], () => {
        screen.remove(renameBox);
        chatBox.focus();
        screen.render();
      });
    }
  });

  // Pin/Unpin conversation (p)
  screen.key(['p'], () => {
    if (mode === 'normal' && !editorOpen) {
      conversation.pinned = !conversation.pinned;
      configStore.saveConversation(conversation);
      const status = conversation.pinned ? 'Pinned' : 'Unpinned';
      chatContent += `{magenta-fg}[${status}]{/magenta-fg}\n\n`;
      chatBox.setContent(chatContent);
      screen.render();
    }
  });

  // Fork conversation (o)
  screen.key(['o'], () => {
    if (mode === 'normal' && !editorOpen) {
      const forkedConv: Conversation = {
        id: Date.now().toString(),
        title: `${conversation.title} (fork)`,
        model: conversation.model,
        systemPrompt: conversation.systemPrompt,
        messages: [...conversation.messages],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      configStore.saveConversation(forkedConv);
      chatContent += `{green-fg}[Forked as: ${forkedConv.title}]{/green-fg}\n\n`;
      chatBox.setContent(chatContent);
      screen.render();
    }
  });

  // Set system prompt
  screen.key(['s'], () => {
    if (mode === 'normal' && !editorOpen && !overlayOpen) {
      overlayOpen = true;

      const promptBox = blessed.textbox({
        top: 'center',
        left: 'center',
        width: '80%',
        height: 3,
        label: ' System Prompt (Enter=save, ESC=cancel) ',
        border: { type: 'line' },
        style: { border: { fg: 'yellow' }, bg: 'black', fg: 'white' },
        inputOnFocus: true
      });

      screen.append(promptBox);

      // Pre-fill with current system prompt (must be after append)
      if (conversation.systemPrompt) {
        promptBox.setValue(conversation.systemPrompt);
      }

      promptBox.focus();
      promptBox.readInput();
      screen.render();

      promptBox.on('submit', (value: string) => {
        conversation.systemPrompt = value || '';
        configStore.setDefaultSystemPrompt(conversation.systemPrompt);
        screen.remove(promptBox);
        chatContent += `[System prompt: ${value || '(cleared)'}]\n\n`;
        chatBox.setContent(chatContent);
        chatBox.focus();
        overlayOpen = false;
        screen.render();
      });

      promptBox.on('cancel', () => {
        screen.remove(promptBox);
        chatBox.focus();
        overlayOpen = false;
        screen.render();
      });
    }
  });
  screen.key(['C-f'], async () => {
    if (mode === 'normal' && !editorOpen) {
      let currentDir = process.cwd();
      const codeExtensions = ['.ts', '.js', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.sql'];

      const fileList = blessed.box({
        top: 'center',
        left: 'center',
        width: '80%',
        height: '70%',
        label: '',
        border: { type: 'line' },
        style: { border: { fg: 'green' }, bg: 'black' },
        scrollable: true,
        keys: true,
        tags: true
      });

      let items: { name: string; isDir: boolean; fullPath: string }[] = [];
      let selectedIndex = 0;

      const loadDir = (dir: string) => {
        currentDir = dir;
        items = [];
        selectedIndex = 0;

        try {
          const parent = path.dirname(dir);
          if (parent !== dir) {
            items.push({ name: '..', isDir: true, fullPath: parent });
          }

          const allFiles = fs.readdirSync(dir);

          // Directories first
          allFiles.forEach(f => {
            try {
              const fp = path.join(dir, f);
              if (fs.statSync(fp).isDirectory() && !f.startsWith('.')) {
                items.push({ name: f, isDir: true, fullPath: fp });
              }
            } catch { }
          });

          // Code files
          allFiles.forEach(f => {
            try {
              const fp = path.join(dir, f);
              const ext = path.extname(f).toLowerCase();
              if (codeExtensions.includes(ext) && fs.statSync(fp).isFile()) {
                items.push({ name: f, isDir: false, fullPath: fp });
              }
            } catch { }
          });
        } catch {
          items = [{ name: '..', isDir: true, fullPath: path.dirname(dir) }];
        }
        renderList();
      };

      const renderList = () => {
        fileList.setLabel(` ${currentDir} | j/k=nav Enter/l=select h=back ESC=close `);
        let content = '';
        items.forEach((item, i) => {
          const sel = i === selectedIndex;
          const pre = sel ? '{green-fg}> ' : '  ';
          const suf = sel ? '{/green-fg}' : '';
          const icon = item.isDir ? '{cyan-fg}[DIR]{/cyan-fg} ' : '';
          content += `${pre}${icon}${item.name}${suf}\n`;
        });
        fileList.setContent(content);
        screen.render();
      };

      screen.append(fileList);
      fileList.focus();
      loadDir(currentDir);

      fileList.key(['j', 'down'], () => {
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        renderList();
      });

      fileList.key(['k', 'up'], () => {
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderList();
      });

      fileList.key(['h'], () => {
        const parent = path.dirname(currentDir);
        if (parent !== currentDir) loadDir(parent);
      });

      fileList.key(['l', 'enter'], () => {
        const sel = items[selectedIndex];
        if (!sel) return;

        if (sel.isDir) {
          loadDir(sel.fullPath);
        } else {
          try {
            const content = fs.readFileSync(sel.fullPath, 'utf-8');
            const maxChunkSize = 4000;
            const fileName = path.basename(sel.fullPath);
            const ext = path.extname(fileName).slice(1);

            screen.remove(fileList);
            chatBox.focus();

            if (content.length <= maxChunkSize) {
              conversation.messages.push({
                role: 'user',
                content: `\`\`\`${ext}\n// File: ${fileName}\n${content}\n\`\`\``,
                timestamp: Date.now()
              });
              chatContent += `{green-fg}[Attached: ${fileName}]{/green-fg}\n\n`;
              addMessage('user', `[File: ${fileName}]`);
            } else {
              const chunks: string[] = [];
              for (let i = 0; i < content.length; i += maxChunkSize) {
                chunks.push(content.slice(i, i + maxChunkSize));
              }
              chunks.forEach((chunk, i) => {
                conversation.messages.push({
                  role: 'user',
                  content: `\`\`\`${ext}\n// File: ${fileName} (${i + 1}/${chunks.length})\n${chunk}\n\`\`\``,
                  timestamp: Date.now()
                });
              });
              chatContent += `{green-fg}[Attached: ${fileName} (${chunks.length} parts)]{/green-fg}\n\n`;
              addMessage('user', `[File: ${fileName} - ${chunks.length} parts]`);
            }

            chatBox.setContent(chatContent);
            configStore.saveConversation(conversation);
            screen.render();
          } catch {
            screen.remove(fileList);
            chatBox.focus();
            chatContent += `{red-fg}[Error reading file]{/red-fg}\n\n`;
            chatBox.setContent(chatContent);
            screen.render();
          }
        }
      });

      fileList.key(['escape'], () => {
        screen.remove(fileList);
        chatBox.focus();
        screen.render();
      });
    }
  });

  // Change theme (press Ctrl+T in normal mode)
  screen.key(['C-t'], () => {
    if (mode === 'normal') {
      try {
        const currentIndex = themeNames.indexOf(configStore.getTheme());
        const nextIndex = (currentIndex + 1) % themeNames.length;
        const nextThemeName = themeNames[nextIndex];

        configStore.setTheme(nextThemeName);
        currentTheme = getTheme(nextThemeName);

        // Try to apply theme immediately (may fail on some widgets)
        try {
          chatBox.style.border = { fg: currentTheme.border };
          inputBox.style.border = { fg: currentTheme.border };
          statusBar.style.fg = currentTheme.status.fg;
          statusBar.style.bg = currentTheme.status.bg;
        } catch (e) {
          // Ignore style errors
        }

        chatContent += `[Theme: ${currentTheme.name}]\n\n`;
        chatBox.setContent(chatContent);
        screen.render();
      } catch (e) {
        // Ignore errors
      }
    }
  });

  // Go back to chat selection (Ctrl+B)
  screen.key(['C-b'], async () => {
    if (mode === 'normal') {
      configStore.saveConversation(conversation);
      screen.destroy();
      await vimChatCommand({});
    }
  });

  // Open split view (Ctrl+S)
  screen.key(['C-s'], async () => {
    if (mode === 'normal' && !editorOpen) {
      configStore.saveConversation(conversation);
      screen.destroy();
      await splitChatCommand({ model, conversation });
    }
  });

  // Open editor overlay (Ctrl+E)
  screen.key(['C-e'], () => {
    if (mode !== 'normal') return;

    editorOpen = true; // Mark editor as open

    let editorMode: 'normal' | 'insert' | 'command' = 'normal';
    let editorContent: string[] = [''];
    let cursorRow = 0;
    let cursorCol = 0;
    let scrollTop = 0;
    let editorFilename = '';
    let modified = false;
    let commandBuffer = '';
    let dialogOpen = false; // Track when save dialog is open
    let fileBrowserOpen = false; // Track when C-f file browser is open
    let activeFileList: any = null; // Reference to file browser for cleanup

    // Save original shortcuts content
    const originalHelpContent = helpBox.getContent();

    // Hide chat elements
    chatBox.hide();
    inputBox.hide();
    statusBar.hide();

    // Update shortcuts panel for editor
    helpBox.setContent(`{yellow-fg}Editor Mode{/yellow-fg}

{cyan-fg}i{/cyan-fg} Insert
{cyan-fg}a{/cyan-fg} Append
{cyan-fg}o{/cyan-fg} New line
{cyan-fg}Esc{/cyan-fg} Normal

{yellow-fg}Move:{/yellow-fg}
{cyan-fg}h/j/k/l{/cyan-fg} ←↓↑→
{cyan-fg}g{/cyan-fg} Top
{cyan-fg}G{/cyan-fg} Bottom

{yellow-fg}Edit:{/yellow-fg}
{green-fg}d{/green-fg} Delete line
{green-fg}C-s{/green-fg} Quick save
{magenta-fg}C-f{/magenta-fg} Open file

{yellow-fg}Commands:{/yellow-fg}
{magenta-fg}:w{/magenta-fg} Save
{magenta-fg}:q{/magenta-fg} Quit
{magenta-fg}:wq{/magenta-fg} Save+Quit

{red-fg}Esc{/red-fg} Close`);

    // Editor container
    const editorBox = blessed.box({
      top: 0,
      left: 0,
      width: '80%',
      height: '100%-2',
      label: ' {cyan-fg}Editor{/cyan-fg} ',
      border: { type: 'line' },
      style: { border: { fg: currentTheme.borderFocus }, bg: 'black' },
      tags: true,
      keys: false, // Disable to prevent Tab capture - we have custom handler
      keyable: true,
      input: true
    });

    const editorStatus = blessed.box({
      bottom: 1,
      left: 0,
      width: '100%',
      height: 1,
      style: { fg: 'black', bg: 'white' }
    });

    const editorCmd = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { fg: 'white', bg: 'black' },
      tags: true
    });

    screen.append(editorBox);
    screen.append(editorStatus);
    screen.append(editorCmd);
    helpBox.height = '100%-2'; // Match editor height
    editorBox.focus();
    (editorBox as any).enableInput();

    const visibleLines = () => Math.floor((screen.height as number) - 5);

    const updateEditorStatus = () => {
      const modeStr = editorMode.toUpperCase();
      const mod = modified ? '[+]' : '';
      const pos = `${cursorRow + 1}:${cursorCol + 1}`;
      const file = editorFilename || '[New]';
      editorStatus.setContent(` ${modeStr} | ${file} ${mod} | ${pos}`);
    };

    const renderEditor = () => {
      let display = '';
      const height = visibleLines();

      if (cursorRow < scrollTop) scrollTop = cursorRow;
      else if (cursorRow >= scrollTop + height) scrollTop = cursorRow - height + 1;

      for (let i = 0; i < height; i++) {
        const lineNum = scrollTop + i;
        if (lineNum >= editorContent.length) {
          display += `{gray-fg}~{/gray-fg}\n`;
          continue;
        }

        const lineNumStr = String(lineNum + 1).padStart(4, ' ');
        let line = editorContent[lineNum] || '';
        const isCursorLine = lineNum === cursorRow;

        // Cursor line indicator
        const indicator = isCursorLine ? '{green-fg}>{/green-fg}' : ' ';
        const lineNumColor = isCursorLine ? '{yellow-fg}' : '{gray-fg}';
        const lineNumEnd = isCursorLine ? '{/yellow-fg}' : '{/gray-fg}';

        if (isCursorLine) {
          const before = line.slice(0, cursorCol);
          const cursor = line[cursorCol] || ' ';
          const after = line.slice(cursorCol + 1);
          line = `${before}{black-bg}{cyan-fg}${cursor}{/cyan-fg}{/black-bg}${after}`;
        }

        display += `${indicator}${lineNumColor}${lineNumStr}${lineNumEnd} ${line}\n`;
      }

      editorBox.setContent(display);
      updateEditorStatus();
      editorCmd.setContent(editorMode === 'command' ? `:${commandBuffer}` : '');
      screen.render();
    };

    // Set callback for workspace to load files (must be after renderEditor is defined)
    loadFileInEditor = (filePath: string, fileName: string) => {
      try {
        editorContent = fs.readFileSync(filePath, 'utf-8').split('\n');
        editorFilename = filePath;
        cursorRow = 0;
        cursorCol = 0;
        scrollTop = 0;
        modified = false;
        editorMode = 'normal'; // Ensure normal mode for navigation
        editorBox.setLabel(` {cyan-fg}${fileName}{/cyan-fg} `);
        editorBox.focus();
        renderEditor();
      } catch (err) {
        // Failed to load file
      }
    };

    const saveEditorFile = (newFilename?: string): boolean => {
      if (newFilename) editorFilename = newFilename;

      if (!editorFilename) {
        // Prompt for filename
        promptForFilename();
        return false;
      }
      try {
        fs.writeFileSync(editorFilename, editorContent.join('\n'));
        modified = false;
        editorCmd.setContent(`{green-fg}Saved: ${editorFilename}{/green-fg}`);
        renderEditor();
        return true;
      } catch {
        editorCmd.setContent('{red-fg}Error saving{/red-fg}');
        screen.render();
        return false;
      }
    };

    const promptForFilename = () => {
      dialogOpen = true;
      let saveDir = process.cwd();
      let filename = '';

      const saveDialog = blessed.box({
        top: 'center',
        left: 'center',
        width: '70%',
        height: 10,
        label: ' {cyan-fg}Save As{/cyan-fg} ',
        border: { type: 'line' },
        style: { border: { fg: 'cyan' }, bg: 'black' },
        tags: true
      });

      screen.append(saveDialog);

      const updateSaveDialog = () => {
        saveDialog.setContent(
          `  {gray-fg}Folder:{/gray-fg} ${saveDir}\n\n` +
          `  {yellow-fg}Tab{/yellow-fg}=Browse  {yellow-fg}Enter{/yellow-fg}=Save  {yellow-fg}ESC{/yellow-fg}=Cancel\n\n` +
          `  Filename: {cyan-fg}${filename}{/cyan-fg}{white-bg} {/white-bg}`
        );
        screen.render();
      };

      updateSaveDialog();

      let inputOpen = true;
      const inputHandler = (ch: string, key: any) => {
        if (!inputOpen || !key) return;

        if (key.name === 'enter') {
          inputOpen = false;
          screen.removeListener('keypress', inputHandler);
          screen.remove(saveDialog);
          dialogOpen = false;

          if (filename.trim()) {
            const fullPath = path.join(saveDir, filename.trim());
            editorFilename = fullPath;
            saveEditorFile();
          } else {
            editorCmd.setContent('{yellow-fg}Cancelled - no filename{/yellow-fg}');
            editorBox.focus();
            renderEditor();
          }
        } else if (key.name === 'escape') {
          inputOpen = false;
          screen.removeListener('keypress', inputHandler);
          screen.remove(saveDialog);
          dialogOpen = false;
          editorCmd.setContent('{yellow-fg}Cancelled{/yellow-fg}');
          editorBox.focus();
          renderEditor();
        } else if (key.name === 'backspace') {
          filename = filename.slice(0, -1);
          updateSaveDialog();
        } else if (key.name === 'tab') {
          // Open folder browser
          inputOpen = false;
          screen.removeListener('keypress', inputHandler);
          openFolderBrowser(saveDir, saveDialog, (newDir: string) => {
            saveDir = newDir;
            inputOpen = true;
            screen.on('keypress', inputHandler);
            updateSaveDialog();
          }, () => {
            inputOpen = true;
            screen.on('keypress', inputHandler);
            updateSaveDialog();
          });
        } else if (ch && ch.length === 1 && !key.ctrl && !key.meta && ch !== '\r' && ch !== '\n') {
          filename += ch;
          updateSaveDialog();
        }
      };

      screen.on('keypress', inputHandler);
    };

    // Folder browser helper function
    const openFolderBrowser = (
      currentDir: string,
      parentDialog: any,
      onSelect: (dir: string) => void,
      onCancel: () => void
    ) => {
      let saveDir = currentDir;
      const folderList = blessed.list({
        top: 'center',
        left: 'center',
        width: '60%',
        height: '50%',
        label: ` {cyan-fg}j/k{/cyan-fg}=Move  {cyan-fg}Enter{/cyan-fg}=Select  {cyan-fg}h{/cyan-fg}=Back  {cyan-fg}ESC{/cyan-fg}=Cancel `,
        border: { type: 'line' },
        style: {
          border: { fg: 'green' },
          selected: { bg: 'green', fg: 'black' },
          item: { fg: 'white' }
        },
        tags: true
      });

      const loadFolders = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir);
          const folders = entries.filter(e => {
            try {
              return fs.statSync(path.join(dir, e)).isDirectory() && !e.startsWith('.');
            } catch { return false; }
          });
          folderList.setItems([
            '{cyan-fg}[.] Select this folder{/cyan-fg}',
            '{cyan-fg}[..] Parent folder{/cyan-fg}',
            ...folders.map(f => `{cyan-fg}[DIR]{/cyan-fg} ${f}`)
          ]);
          folderList.setLabel(` ${dir} `);
        } catch {
          folderList.setItems(['{cyan-fg}[..] Parent folder{/cyan-fg}']);
        }
        folderList.select(0);
        screen.render();
      };

      screen.append(folderList);
      loadFolders(saveDir);

      const folderHandler = (ch: string, key: any) => {
        if (!key) return;

        if (key.name === 'j' || key.name === 'down') {
          folderList.down(1);
          screen.render();
        } else if (key.name === 'k' || key.name === 'up') {
          folderList.up(1);
          screen.render();
        } else if (key.name === 'h') {
          saveDir = path.dirname(saveDir);
          loadFolders(saveDir);
        } else if (key.name === 'enter') {
          const idx = (folderList as any).selected as number;
          if (idx === 0) {
            screen.removeListener('keypress', folderHandler);
            screen.remove(folderList);
            onSelect(saveDir);
          } else if (idx === 1) {
            saveDir = path.dirname(saveDir);
            loadFolders(saveDir);
          } else {
            const items = (folderList as any).items;
            const selected = items[idx].content || items[idx].getText();
            const folderName = selected.replace('{cyan-fg}[DIR]{/cyan-fg} ', '').replace(/\{[^}]+\}/g, '');
            saveDir = path.join(saveDir, folderName);
            loadFolders(saveDir);
          }
        } else if (key.name === 'escape') {
          screen.removeListener('keypress', folderHandler);
          screen.remove(folderList);
          onCancel();
        }
      };

      screen.on('keypress', folderHandler);
    };

    const closeEditor = () => {
      if (!editorOpen) return; // Prevent double close
      screen.removeListener('keypress', editorKeyHandler);
      screen.remove(editorBox);
      screen.remove(editorStatus);
      screen.remove(editorCmd);

      // Close workspace if still open
      if (workspaceOpen && activeWorkspaceBox) {
        screen.remove(activeWorkspaceBox);
        if (activeWsKeyHandler) {
          screen.removeListener('keypress', activeWsKeyHandler);
        }
        workspaceOpen = false;
        activeWorkspaceBox = null;
        activeWsKeyHandler = null;
      }

      // Close file browser if still open
      if (fileBrowserOpen && activeFileList) {
        screen.remove(activeFileList);
        fileBrowserOpen = false;
        activeFileList = null;
      }

      // Restore chat elements
      chatBox.show();
      inputBox.show();
      statusBar.show();
      // Restore shortcuts panel
      helpBox.setContent(originalHelpContent);
      helpBox.height = '100%-5'; // Reset height to match chatBox
      helpBox.show(); // Make sure helpBox is visible
      editorOpen = false; // Mark editor as closed
      loadFileInEditor = null; // Clear callback
      // Refresh chat content to clear any artifacts
      chatBox.setContent(chatContent);
      chatBox.focus();
      updateStatus(); // Restore status bar content
      screen.render();
    };

    const tryCloseEditor = () => {
      if (!editorOpen || dialogOpen) return;

      // Only ask to save if modified AND has content
      const hasContent = editorContent.length > 1 || (editorContent.length === 1 && editorContent[0].trim() !== '');
      if (modified && hasContent) {
        dialogOpen = true;
        // Show confirmation dialog
        const confirmBox = blessed.box({
          top: 'center',
          left: 'center',
          width: 50,
          height: 7,
          label: ' {yellow-fg}Unsaved Changes{/yellow-fg} ',
          border: { type: 'line' },
          style: { border: { fg: 'yellow' }, bg: 'black' },
          tags: true,
          keys: true,
          keyable: true,
          content: `\n  Save changes before closing?\n\n  {green-fg}y{/green-fg}=Save  {red-fg}n{/red-fg}=Don't save  {cyan-fg}c{/cyan-fg}=Cancel`
        });

        screen.append(confirmBox);
        confirmBox.focus();
        screen.render();

        confirmBox.key(['y'], () => {
          screen.remove(confirmBox);
          dialogOpen = false;
          if (saveEditorFile()) {
            closeEditor();
          } else {
            editorBox.focus();
            renderEditor();
          }
        });

        confirmBox.key(['n'], () => {
          screen.remove(confirmBox);
          dialogOpen = false;
          closeEditor();
        });

        confirmBox.key(['c', 'escape'], () => {
          screen.remove(confirmBox);
          dialogOpen = false;
          editorBox.focus();
          renderEditor();
        });
      } else {
        closeEditor();
      }
    };

    const executeEditorCommand = (cmd: string) => {
      const parts = cmd.trim().split(' ');
      const command = parts[0];
      const arg = parts.slice(1).join(' ');

      switch (command) {
        case 'w':
          if (arg) editorFilename = arg;
          saveEditorFile();
          break;
        case 'q':
          tryCloseEditor();
          break;
        case 'q!':
          closeEditor();
          break;
        case 'wq':
          if (saveEditorFile()) closeEditor();
          break;
        case 'e':
          if (arg && fs.existsSync(arg)) {
            editorFilename = arg;
            editorContent = fs.readFileSync(arg, 'utf-8').split('\n');
            cursorRow = 0;
            cursorCol = 0;
            modified = false;
          }
          break;
        case 'new':
          editorFilename = arg || '';
          editorContent = [''];
          cursorRow = 0;
          cursorCol = 0;
          modified = false;
          break;
        default:
          const lineNum = parseInt(command);
          if (!isNaN(lineNum)) {
            cursorRow = Math.min(Math.max(0, lineNum - 1), editorContent.length - 1);
            cursorCol = 0;
          }
      }
      editorMode = 'normal';
      commandBuffer = '';
      renderEditor();
    };

    const editorKeyHandler = (ch: string, key: any) => {
      if (!editorOpen || !key || dialogOpen) return;

      // Let file browser handle its own keys when open
      if (fileBrowserOpen) return;

      // Let wsKeyHandler handle keys when workspace is open and focused
      if (workspaceOpen && wsFocused) {
        // Only allow Ctrl+O to close workspace
        if (!(key.ctrl && key.name === 'o')) return;
      }

      // Command mode
      if (editorMode === 'command') {
        if (key.name === 'enter') {
          executeEditorCommand(commandBuffer);
        } else if (key.name === 'escape') {
          editorMode = 'normal';
          commandBuffer = '';
          renderEditor();
        } else if (key.name === 'backspace') {
          commandBuffer = commandBuffer.slice(0, -1);
          renderEditor();
        } else if (ch && ch.length === 1) {
          commandBuffer += ch;
          renderEditor();
        }
        return;
      }

      // Insert mode
      if (editorMode === 'insert') {
        if (key.name === 'escape') {
          editorMode = 'normal';
          renderEditor();
          return;
        }

        if (key.name === 'enter') {
          const line = editorContent[cursorRow];
          editorContent[cursorRow] = line.slice(0, cursorCol);
          editorContent.splice(cursorRow + 1, 0, line.slice(cursorCol));
          cursorRow++;
          cursorCol = 0;
          modified = true;
          renderEditor();
          return;
        }
        if (key.name === 'up' && (!workspaceOpen || !wsFocused)) {
          if (cursorRow > 0) {
            cursorRow--;
            // Adjust cursorCol if new line is shorter
            cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
          }
          renderEditor();
          return;
        }
        if (key.name === 'down' && (!workspaceOpen || !wsFocused)) {
          if (cursorRow < editorContent.length - 1) {
            cursorRow++;
            // Adjust cursorCol if new line is shorter
            cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
          }
          renderEditor();
          return;
        }
        if (key.name === 'left') {
          if (cursorCol > 0) {
            cursorCol--;
          } else if (cursorRow > 0) {
            cursorRow--;
            cursorCol = editorContent[cursorRow].length;
          }
          renderEditor();
          return;
        }
        if (key.name === 'right') {
          cursorCol++;
          renderEditor();
          return;
        }
        if (key.name === 'end') {
          cursorCol = editorContent[cursorRow].length;
          renderEditor();
          return;
        }
        if (key.name === 'home') {
          cursorCol = 0;
          renderEditor();
          return;
        }

        if (key.name === 'backspace') {
          if (cursorCol > 0) {
            const line = editorContent[cursorRow];
            editorContent[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
            cursorCol--;
            modified = true;
          } else if (cursorRow > 0) {
            const currLine = editorContent[cursorRow];
            const prevLine = editorContent[cursorRow - 1];
            cursorCol = prevLine.length;
            editorContent[cursorRow - 1] = prevLine + currLine;
            editorContent.splice(cursorRow, 1);
            cursorRow--;
            modified = true;
          }
          renderEditor();
          return;
        }

        if (ch && ch.length === 1 && ch !== '\r' && ch !== '\n') {
          const line = editorContent[cursorRow];
          editorContent[cursorRow] = line.slice(0, cursorCol) + ch + line.slice(cursorCol);
          cursorCol++;
          modified = true;
          renderEditor();
          return;
        }
        return;
      }

      // Normal mode
      if (key.ctrl && key.name === 's') {
        saveEditorFile();
        return;
      }

      // File browser (Ctrl+F)
      if (key.ctrl && key.name === 'f') {
        let currentDir = process.cwd();
        const codeExtensions = ['.ts', '.js', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.sql'];

        const showFileBrowser = () => {
          let entries: { name: string; isDir: boolean }[] = [];
          try {
            const allEntries = fs.readdirSync(currentDir);
            entries.push({ name: '..', isDir: true });
            for (const entry of allEntries) {
              try {
                const stat = fs.statSync(path.join(currentDir, entry));
                if (stat.isDirectory() && !entry.startsWith('.')) {
                  entries.push({ name: entry, isDir: true });
                }
              } catch { }
            }
            for (const entry of allEntries) {
              try {
                const stat = fs.statSync(path.join(currentDir, entry));
                if (stat.isFile()) {
                  const ext = path.extname(entry).toLowerCase();
                  if (codeExtensions.includes(ext)) {
                    entries.push({ name: entry, isDir: false });
                  }
                }
              } catch { }
            }
          } catch {
            editorCmd.setContent('{red-fg}Error reading directory{/red-fg}');
            screen.render();
            return;
          }

          const fileList = blessed.list({
            top: 'center',
            left: 'center',
            width: '60%',
            height: '50%',
            label: ` ${currentDir} `,
            border: { type: 'line' },
            style: {
              border: { fg: 'cyan' },
              selected: { bg: 'cyan', fg: 'black' }
            },
            keys: true,
            vi: true,
            mouse: true,
            tags: true,
            items: entries.map(e => e.isDir ? `{cyan-fg}[DIR]{/cyan-fg} ${e.name}` : e.name)
          });

          screen.append(fileList);
          fileBrowserOpen = true;
          activeFileList = fileList;
          fileList.focus();
          screen.render();

          fileList.key(['enter'], () => {
            const idx = (fileList as any).selected as number;
            const entry = entries[idx];

            if (entry.isDir) {
              screen.remove(fileList);
              if (entry.name === '..') {
                currentDir = path.dirname(currentDir);
              } else {
                currentDir = path.join(currentDir, entry.name);
              }
              showFileBrowser();
            } else {
              const filePath = path.join(currentDir, entry.name);
              try {
                editorFilename = filePath;
                editorContent = fs.readFileSync(filePath, 'utf-8').split('\n');
                cursorRow = 0;
                cursorCol = 0;
                scrollTop = 0;
                modified = false;
              } catch {
                editorCmd.setContent('{red-fg}Error loading file{/red-fg}');
              }
              screen.remove(fileList);
              fileBrowserOpen = false;
              activeFileList = null;
              editorBox.focus();
              renderEditor();
            }
          });

          fileList.key(['h'], () => {
            screen.remove(fileList);
            currentDir = path.dirname(currentDir);
            showFileBrowser();
          });

          fileList.key(['escape'], () => {
            screen.remove(fileList);
            fileBrowserOpen = false;
            activeFileList = null;
            editorBox.focus();
            renderEditor();
          });
        };

        showFileBrowser();
        return;
      }

      // Normal mode handlers
      if (editorMode === 'normal') {
        switch (key.name) {
          case 'escape':
          case 'q':
            tryCloseEditor();
            break;
          case 'i':
            editorMode = 'insert';
            renderEditor();
            break;
          case 'a':
            editorMode = 'insert';
            cursorCol = Math.min(cursorCol + 1, editorContent[cursorRow].length);
            renderEditor();
            break;
          case 'o':
            if (!key.ctrl) { // Don't trigger on Ctrl+O
              editorContent.splice(cursorRow + 1, 0, '');
              cursorRow++;
              cursorCol = 0;
              editorMode = 'insert';
              modified = true;
              renderEditor();
            }
            break;
          case 'h':
          case 'left':
            cursorCol = Math.max(0, cursorCol - 1);
            renderEditor();
            break;
          case 'l':
          case 'right':
            cursorCol = Math.min(editorContent[cursorRow].length - 1, cursorCol + 1);
            renderEditor();
            break;
          case 'j':
          case 'down':
            if (!workspaceOpen) {
              cursorRow = Math.min(editorContent.length - 1, cursorRow + 1);
              cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
              renderEditor();
            }
            break;
          case 'k':
          case 'up':
            if (!workspaceOpen) {
              cursorRow = Math.max(0, cursorRow - 1);
              cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
              renderEditor();
            }
            break;
          case 'g':
            cursorRow = 0;
            cursorCol = 0;
            renderEditor();
            break;
          case 'd':
            if (editorContent.length > 1) {
              editorContent.splice(cursorRow, 1);
              cursorRow = Math.min(cursorRow, editorContent.length - 1);
              modified = true;
            } else {
              editorContent = [''];
              cursorCol = 0;
              modified = true;
            }
            renderEditor();
            break;
        }

        if (key.shift && key.name === 'g') {
          cursorRow = editorContent.length - 1;
          cursorCol = 0;
          renderEditor();
        }

        if (ch === ':') {
          editorMode = 'command';
          commandBuffer = '';
          renderEditor();
        }
      }
    };

    screen.on('keypress', editorKeyHandler);
    renderEditor();
  });

  screen.key(['C-c'], () => process.exit(0));

  chatBox.focus();
  updateStatus();
  screen.render();
}
