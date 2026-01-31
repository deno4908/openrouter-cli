import blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import clipboard from 'clipboardy';
import { openRouterAPI, FreeModel } from '../api/openrouter';
import { configStore, Conversation } from '../config/store';
import { getTheme } from '../config/themes';

interface ChatPanel {
    box: blessed.Widgets.BoxElement;
    inputBox: blessed.Widgets.TextboxElement;
    conversation: Conversation;
    model: string;
    chatContent: string;
    mode: 'normal' | 'insert';
}

// Model selector overlay (like vim-chat)
function selectModelSync(screen: blessed.Widgets.Screen, models: FreeModel[], currentModel: string): Promise<string> {
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
        const contentHeight = visibleHeight - 2;

        function renderList() {
            let content = '';
            models.forEach((m, i) => {
                const prefix = i === selectedIndex ? '{cyan-bg}{black-fg} > ' : '   ';
                const suffix = i === selectedIndex ? ' {/black-fg}{/cyan-bg}' : '';
                const current = m.id === currentModel ? ' (current)' : '';
                content += `${prefix}${m.name}${current}${suffix}\n`;
            });
            overlay.setContent(content);
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

        // Use overlay.key instead of screen.key to prevent propagation to main handlers
        overlay.key(['j', 'down'], () => {
            if (!done) {
                selectedIndex = Math.min(selectedIndex + 1, models.length - 1);
                renderList();
            }
        });

        overlay.key(['k', 'up'], () => {
            if (!done) {
                selectedIndex = Math.max(selectedIndex - 1, 0);
                renderList();
            }
        });

        overlay.key(['enter'], () => {
            if (!done) {
                done = true;
                screen.remove(overlay);
                screen.render();
                resolve(models[selectedIndex].id);
            }
        });

        overlay.key(['escape'], () => {
            if (!done) {
                done = true;
                screen.remove(overlay);
                screen.render();
                resolve(currentModel);
            }
        });
    });
}

export async function splitChatCommand(options: { model?: string, conversation?: Conversation }) {
    console.clear();

    const currentTheme = getTheme(configStore.getTheme());

    // Load models
    let models: FreeModel[] = [];
    try {
        models = await openRouterAPI.getFreeModels();
    } catch {
        models = [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', context_length: 32000 }];
    }

    const defaultModel = options.model || options.conversation?.model || models[0]?.id || 'meta-llama/llama-3.3-70b-instruct:free';

    const screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
        title: 'Split Chat + Editor'
    });

    // Detect Termux (Android terminal) to keep keyboard open
    const isTermux = process.env.TERMUX_VERSION !== undefined ||
        process.env.PREFIX?.includes('com.termux') ||
        process.platform === 'android';

    // ===== LEFT PANEL: CHAT =====
    const chatBox = blessed.box({
        top: 0,
        left: 0,
        width: '50%',
        height: '100%-5',
        label: ' Chat [ACTIVE] ',
        border: { type: 'line' },
        style: {
            border: { fg: currentTheme.borderFocus },
            label: { fg: 'cyan' }
        },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: '|' },
        mouse: true,
        keys: true,
        vi: true,
        tags: true
    });

    const chatInputBox = blessed.textbox({
        bottom: 1,
        left: 0,
        width: '50%',
        height: 3,
        label: ' Input ',
        border: { type: 'line' },
        style: {
            fg: 'white',
            bg: 'black',
            border: { fg: currentTheme.border },
            label: { fg: 'yellow' },
            focus: { border: { fg: currentTheme.borderFocus } }
        },
        inputOnFocus: true
    });

    // Default system prompt to prevent emojis
    const noEmojiPrompt = 'Do not use icons or emojis in your responses. Keep responses clean and text-only.';

    // Use existing conversation or create new
    const conversation: Conversation = options.conversation ? {
        ...options.conversation,
        messages: [...options.conversation.messages],
        systemPrompt: options.conversation.systemPrompt || noEmojiPrompt  // Ensure prompt exists
    } : {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        title: 'New Chat',
        model: defaultModel,
        messages: [],
        systemPrompt: noEmojiPrompt,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    let chatContent = '';
    let chatMode: 'normal' | 'insert' = 'normal';
    let overlayOpen = false; // Track when model selector or other overlay is open
    let attachedFile: string | null = null; // Attached file content
    let attachedFileName: string | null = null; // Attached file name

    // Build chat content from existing messages
    if (options.conversation) {
        for (const msg of options.conversation.messages) {
            const prefix = msg.role === 'user' ? '{green-fg}You: ' : '{cyan-fg}AI: ';
            const suffix = msg.role === 'user' ? '{/green-fg}' : '{/cyan-fg}';
            const displayContent = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
            chatContent += `${prefix}${displayContent}${suffix}\n\n`;
        }
        chatBox.setContent(chatContent);
    }

    // ===== RIGHT PANEL: EDITOR =====
    const editorBox = blessed.box({
        top: 0,
        left: '50%',
        width: '50%',
        height: '100%-5',
        label: ' Editor ',
        border: { type: 'line' },
        style: {
            border: { fg: currentTheme.border },
            label: { fg: 'green' }
        },
        tags: true,
        scrollable: true,  // We handle scrolling manually
        keys: false  // Disable blessed key handling - we handle keys manually
    });

    const editorStatus = blessed.box({
        bottom: 1,
        left: '50%',
        width: '50%',
        height: 3,
        label: ' Status ',
        border: { type: 'line' },
        style: {
            border: { fg: currentTheme.border },
            label: { fg: 'yellow' }
        },
        tags: true
    });

    // Editor state
    let editorContent: string[] = [''];
    let editorFilename: string = '';
    let cursorRow = 0;
    let cursorCol = 0;
    let scrollTop = 0;
    let editorMode: 'normal' | 'insert' | 'command' = 'normal';
    let modified = false;
    let commandBuffer = '';

    // Active panel: 'chat' or 'editor'
    let activePanel: 'chat' | 'editor' = 'chat';

    // Split ratio (left panel percentage, 20-80 range)
    let splitRatio = 50;

    // Function to resize panels
    const resizePanels = () => {
        const leftWidth = `${splitRatio}%`;
        const rightWidth = `${100 - splitRatio}%`;
        const rightLeft = `${splitRatio}%`;

        chatBox.width = leftWidth;
        chatInputBox.width = leftWidth;
        editorBox.left = rightLeft;
        editorBox.width = rightWidth;
        editorStatus.left = rightLeft;
        editorStatus.width = rightWidth;

        renderEditor();
        screen.render();
    };

    // Status bar
    const statusBar = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        style: { fg: currentTheme.status.fg, bg: currentTheme.status.bg }
    });

    // ===== FUNCTIONS =====
    const renderEditor = () => {
        const boxHeight = (editorBox.height as number) - 2;
        const boxWidth = (editorBox.width as number) - 2;

        // Scroll handling
        if (cursorRow < scrollTop) scrollTop = cursorRow;
        if (cursorRow >= scrollTop + boxHeight) scrollTop = cursorRow - boxHeight + 1;

        const lines: string[] = [];

        // Show placeholder if editor is empty
        if (editorContent.length === 1 && editorContent[0] === '') {
            lines.push('  [Empty Editor]');
            lines.push('  Ctrl+F = Open file');
            lines.push('  i = Start typing');
        } else {
            for (let i = scrollTop; i < Math.min(editorContent.length, scrollTop + boxHeight); i++) {
                const lineNum = String(i + 1).padStart(3, ' ');
                let line = (editorContent[i] || '').replace(/\t/g, '  ').replace(/\r/g, '');
                if (line.length > boxWidth - 5) line = line.slice(0, boxWidth - 5);

                if (i === cursorRow && activePanel === 'editor') {
                    const col = Math.min(cursorCol, line.length);
                    const before = line.slice(0, col);
                    const cursorChar = line[col] || ' ';
                    const after = line.slice(col + 1);
                    // Use █ block cursor or underline style
                    lines.push(`${lineNum}│${before}█${after}`);
                } else {
                    lines.push(`${lineNum}│${line}`);
                }
            }
        }

        editorBox.setContent(lines.join('\n'));

        // Update editor status
        const modeStr = editorMode.toUpperCase();
        const fileStr = editorFilename ? path.basename(editorFilename) : '[No File]';
        const modStr = modified ? '[+]' : '';
        editorStatus.setContent(`${modeStr} | ${fileStr} ${modStr} | L${cursorRow + 1}:C${cursorCol + 1}`);

        screen.render();
    };

    const updateStatus = () => {
        const side = activePanel === 'chat' ? 'CHAT' : 'EDITOR';
        const mode = activePanel === 'chat' ? chatMode.toUpperCase() : editorMode.toUpperCase();
        const modelShort = conversation.model.split('/').pop()?.replace(':free', '') || conversation.model;
        statusBar.setContent(`[${mode}] ${side} | ${modelShort} | Tab=switch i=insert C-b=back q=quit`);
        screen.render();
    };

    const updateBorders = () => {
        chatBox.style.border.fg = activePanel === 'chat' ? currentTheme.borderFocus : currentTheme.border;
        editorBox.style.border.fg = activePanel === 'editor' ? currentTheme.borderFocus : currentTheme.border;
        chatBox.setLabel(activePanel === 'chat' ? ' Chat [ACTIVE] ' : ' Chat ');
        editorBox.setLabel(activePanel === 'editor' ? ' Editor [ACTIVE] ' : ' Editor ');
    };

    const addMessage = (role: 'user' | 'assistant', content: string) => {
        const prefix = role === 'user' ? '{green-fg}You: ' : '{cyan-fg}AI: ';
        const suffix = role === 'user' ? '{/green-fg}' : '{/cyan-fg}';
        const displayContent = content.length > 500 ? content.slice(0, 500) + '...' : content;
        chatContent += `${prefix}${displayContent}${suffix}\n\n`;
        chatBox.setContent(chatContent);
        chatBox.setScrollPerc(100);
    };

    const CHUNK_SIZE = 4000; // 4K characters per chunk

    const sendMessage = async (isRegenerate: boolean = false) => {
        if (!isRegenerate) {
            const message = chatInputBox.getValue().trim();
            if (!message) return;

            chatInputBox.setValue('');

            // Handle large attached files - split into chunks
            if (attachedFile && attachedFileName) {
                const ext = attachedFileName.split('.').pop() || 'txt';
                const fileContent = attachedFile;
                const totalLength = fileContent.length;

                if (totalLength > CHUNK_SIZE) {
                    const totalChunks = Math.ceil(totalLength / CHUNK_SIZE);

                    addMessage('user', `[Attaching: ${attachedFileName} (${totalChunks} chunks)]`);
                    chatContent += `{yellow-fg}[Sending large file in ${totalChunks} chunks...]{/yellow-fg}\n\n`;
                    chatBox.setContent(chatContent);
                    screen.render();

                    for (let i = 0; i < totalChunks; i++) {
                        const start = i * CHUNK_SIZE;
                        const chunkContent = fileContent.slice(start, start + CHUNK_SIZE);
                        const chunkMessage = `[File: ${attachedFileName}] [Chunk ${i + 1}/${totalChunks}]\n\`\`\`${ext}\n${chunkContent}\n\`\`\`\n${i === totalChunks - 1 ? `\nUser message: ${message}` : '\n(Continue...)'}`;

                        updateStatus();
                        conversation.messages.push({ role: 'user', content: chunkMessage, timestamp: Date.now() });

                        if (i < totalChunks - 1) {
                            try {
                                const apiMsgs: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
                                apiMsgs.push({ role: 'system', content: 'IMPORTANT: Never use emojis. Respond briefly: Received chunk X/Y' });
                                apiMsgs.push({ role: 'user', content: chunkMessage });
                                let ack = '';
                                for await (const c of openRouterAPI.chatStream(apiMsgs, conversation.model)) { ack += c; }
                                conversation.messages.push({ role: 'assistant', content: ack || `Received ${i + 1}/${totalChunks}`, timestamp: Date.now() });
                            } catch (e) { }
                        }
                    }

                    attachedFile = null;
                    attachedFileName = null;

                    try {
                        let response = '';
                        chatContent += '{cyan-fg}AI: ';
                        chatBox.setContent(chatContent + '...{/cyan-fg}');
                        screen.render();

                        const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
                        if (conversation.systemPrompt) apiMessages.push({ role: 'system', content: conversation.systemPrompt });
                        apiMessages.push(...conversation.messages.map(m => ({ role: m.role, content: m.content })));

                        for await (const chunk of openRouterAPI.chatStream(apiMessages, conversation.model)) {
                            response += chunk;
                            chatBox.setContent(chatContent + response + '{/cyan-fg}');
                            chatBox.setScrollPerc(100);
                            screen.render();
                        }

                        if (!response) response = '(No response)';
                        chatContent += response + `{/cyan-fg}\n\n`;
                        conversation.messages.push({ role: 'assistant', content: response, timestamp: Date.now() });
                        conversation.updatedAt = Date.now();
                        configStore.saveConversation(conversation);
                    } catch (error: any) {
                        chatContent += `{red-fg}Error: ${error.message}{/red-fg}\n\n`;
                    }

                    chatBox.setContent(chatContent);
                    updateStatus();
                    screen.render();
                    return;
                }
            }

            // Normal message or small file
            let fullMessage = message;
            if (attachedFile && attachedFileName) {
                const ext = attachedFileName.split('.').pop() || 'txt';
                fullMessage = `[File: ${attachedFileName}]\n\`\`\`${ext}\n${attachedFile}\n\`\`\`\n\nUser message: ${message}`;
                attachedFile = null;
                attachedFileName = null;
            }

            addMessage('user', message);
            conversation.messages.push({ role: 'user', content: fullMessage, timestamp: Date.now() });

            if (conversation.messages.length === 1) {
                conversation.title = message.slice(0, 50);
            }
        }

        try {
            let response = '';
            chatContent += '{cyan-fg}AI: ';
            chatBox.setContent(chatContent + '...{/cyan-fg}');
            screen.render();

            const apiMessages: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];

            // Anti-emoji prompt
            apiMessages.push({ role: 'system', content: 'CRITICAL RULE: You MUST NOT use any emojis, emoticons, icons, or special unicode symbols in your responses. Use only plain ASCII text.' });

            if (conversation.systemPrompt) {
                apiMessages.push({ role: 'system', content: conversation.systemPrompt });
            }

            apiMessages.push(...conversation.messages.map(m => ({
                role: m.role,
                content: m.content
            })));

            for await (const chunk of openRouterAPI.chatStream(apiMessages, conversation.model)) {
                response += chunk;
                chatBox.setContent(chatContent + response + '{/cyan-fg}');
                chatBox.setScrollPerc(100);
                screen.render();
            }

            if (!response) response = '(No response)';

            chatContent += response + `{/cyan-fg}\n\n`;

            conversation.messages.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            });

            conversation.updatedAt = Date.now();
            configStore.saveConversation(conversation);
        } catch (error: any) {
            chatContent += `{red-fg}Error: ${error.message}{/red-fg}\n\n`;
        }

        chatBox.setContent(chatContent);
        screen.render();
    };

    const saveEditorFile = () => {
        if (!editorFilename) {
            // Prompt for filename
            const filenameBox = blessed.textbox({
                top: 'center',
                left: 'center',
                width: '60%',
                height: 3,
                label: ' Save As (Enter=save, Esc=cancel) ',
                border: { type: 'line' },
                style: { border: { fg: 'green' }, bg: 'black', fg: 'white' },
                inputOnFocus: true
            });
            screen.append(filenameBox);
            filenameBox.focus();
            screen.render();

            filenameBox.key(['enter'], () => {
                const fn = filenameBox.getValue().trim();
                if (fn) {
                    editorFilename = fn.startsWith('/') || fn.includes(':') ? fn : path.join(process.cwd(), fn);
                    try {
                        fs.writeFileSync(editorFilename, editorContent.join('\n'));
                        modified = false;
                        editorBox.setLabel(` Editor [${path.basename(editorFilename)}] `);
                    } catch { }
                }
                screen.remove(filenameBox);
                editorBox.focus();
                renderEditor();
            });

            filenameBox.key(['escape'], () => {
                screen.remove(filenameBox);
                editorBox.focus();
                renderEditor();
            });
            return;
        }

        try {
            const content = editorContent.join('\n');
            fs.writeFileSync(editorFilename, content);
            modified = false;
            editorStatus.setContent(`Saved: ${editorFilename}`);

            // Attach updated file to chatbox
            const fileName = path.basename(editorFilename);
            const truncated = content.length > 5000 ? content.slice(0, 5000) + '\n...(truncated)' : content;
            chatContent += `{yellow-fg}[Updated: ${fileName}]{/yellow-fg}\n\n`;
            conversation.messages.push({
                role: 'user',
                content: `[Updated File: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``,
                timestamp: Date.now()
            });
            chatBox.setContent(chatContent);
            chatBox.setScrollPerc(100);  // Scroll to bottom to show new content
        } catch (e) {
            editorStatus.setContent(`{red-fg}Error saving{/red-fg}`);
        }
        screen.render();
    };

    // ===== APPEND ELEMENTS =====
    screen.append(chatBox);
    screen.append(chatInputBox);
    screen.append(editorBox);
    screen.append(editorStatus);
    screen.append(statusBar);

    // On Termux, focus chatInputBox immediately to trigger keyboard
    if (isTermux) {
        chatInputBox.focus();
        chatInputBox.readInput();
    }

    updateBorders();
    updateStatus();
    renderEditor();
    if (!isTermux) chatBox.focus();

    // ===== KEY BINDINGS =====

    // Tab to switch panels
    screen.key(['tab'], () => {
        if (chatMode === 'insert') return;
        if (editorMode === 'insert') return;

        activePanel = activePanel === 'chat' ? 'editor' : 'chat';
        updateBorders();
        if (activePanel === 'chat') {
            chatBox.focus();
        } else {
            editorBox.focus();
            renderEditor();
        }
        updateStatus();
    });

    // Chat: i to enter insert mode
    screen.key(['i'], () => {
        if (activePanel === 'chat' && chatMode === 'normal') {
            chatMode = 'insert';
            chatInputBox.focus();
            chatInputBox.readInput();
            updateStatus();
        } else if (activePanel === 'editor' && editorMode === 'normal') {
            editorMode = 'insert';
            renderEditor();
            updateStatus();
        }
    });

    // m to switch model (only in normal mode)
    screen.key(['m'], async () => {
        if (chatMode === 'normal' && editorMode === 'normal') {
            overlayOpen = true; // Prevent scroll while model selector is open
            const previousModel = conversation.model;
            conversation.model = await selectModelSync(screen, models, previousModel);
            overlayOpen = false;
            if (conversation.model !== previousModel) {
                const modelName = models.find(m => m.id === conversation.model)?.name || conversation.model;
                chatContent += `[Model changed to: ${modelName}]\n\n`;
                chatBox.setContent(chatContent);
                chatBox.setScrollPerc(100);
            }
            updateStatus();
            screen.render();
        }
    });

    // ? to show help
    screen.key(['?'], () => {
        if (chatMode !== 'normal' || editorMode !== 'normal') return;

        const helpBox = blessed.box({
            top: 'center',
            left: 'center',
            width: 60,
            height: 28,
            label: ' Keyboard Shortcuts (ESC to close) ',
            border: { type: 'line' },
            style: { border: { fg: 'cyan' }, bg: 'black' },
            tags: true,
            scrollable: true
        });

        helpBox.setContent(`
{yellow-fg}=== GLOBAL ==={/yellow-fg}
  Tab        Switch between Chat/Editor
  q          Quit application
  m          Change AI model
  ?          Show this help

{yellow-fg}=== CHAT PANEL ==={/yellow-fg}
  i          Enter insert mode (type message)
  ESC        Exit insert mode
  Enter      Send message (in insert mode)
  j/k        Scroll chat up/down
  Ctrl+B     Go back to menu

{yellow-fg}=== EDITOR PANEL ==={/yellow-fg}
  i          Enter insert mode
  a          Append after cursor
  o          New line below
  O          New line above
  ESC        Exit to normal mode
  j/k/h/l    Move cursor (normal mode)
  Arrows     Move cursor (insert mode)
  Tab        Insert 4 spaces (insert mode)
  dd         Delete line
  Ctrl+S     Save file
  Ctrl+F     Open file browser

{yellow-fg}=== TERMINAL (Alt+T) ==={/yellow-fg}
  Enter      Run command
  ESC        Close terminal
  Ctrl+D     Browse folders (cd)
`);

        screen.append(helpBox);
        helpBox.focus();
        screen.render();

        helpBox.key(['escape', '?'], () => {
            screen.remove(helpBox);
            if (activePanel === 'chat') chatBox.focus();
            else editorBox.focus();
            screen.render();
        });
    });

    // ESC to exit insert mode
    screen.key(['escape'], () => {
        if (activePanel === 'chat' && chatMode === 'insert') {
            chatMode = 'normal';
            chatBox.focus();
            updateStatus();
        } else if (activePanel === 'editor' && editorMode !== 'normal') {
            editorMode = 'normal';
            commandBuffer = '';
            renderEditor();
            updateStatus();
        }
    });

    chatInputBox.key(['escape'], () => {
        chatMode = 'normal';
        chatBox.focus();
        updateStatus();
    });

    chatInputBox.key(['enter'], async () => {
        if (activePanel !== 'editor' && chatMode === 'insert') {
            await sendMessage();
            chatInputBox.cancel();
            chatMode = 'normal';
            chatBox.focus();
            updateStatus();
        }
    });

    // Navigation j/k
    screen.key(['j'], () => {
        if (overlayOpen) return; // Don't scroll when overlay is open
        if (activePanel === 'chat' && chatMode === 'normal') {
            chatBox.scroll(1);
            screen.render();
        } else if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorRow < editorContent.length - 1) {
                cursorRow++;
                cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
            }
            renderEditor();
        }
    });

    screen.key(['k'], () => {
        if (overlayOpen) return; // Don't scroll when overlay is open
        if (activePanel === 'chat' && chatMode === 'normal') {
            chatBox.scroll(-1);
            screen.render();
        } else if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorRow > 0) {
                cursorRow--;
                cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
            }
            renderEditor();
        }
    });

    screen.key(['h'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorCol > 0) cursorCol--;
            renderEditor();
        }
    });

    screen.key(['l'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorCol < editorContent[cursorRow].length) cursorCol++;
            renderEditor();
        }
    });

    // Arrow key navigation (same as j/k/h/l)
    screen.key(['down'], () => {
        if (overlayOpen) return; // Don't scroll when overlay is open
        if (activePanel === 'chat' && chatMode === 'normal') {
            chatBox.scroll(1);
            screen.render();
        } else if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorRow < editorContent.length - 1) {
                cursorRow++;
                cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
            }
            renderEditor();
        }
    });

    screen.key(['up'], () => {
        if (overlayOpen) return; // Don't scroll when overlay is open
        if (activePanel === 'chat' && chatMode === 'normal') {
            chatBox.scroll(-1);
            screen.render();
        } else if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorRow > 0) {
                cursorRow--;
                cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
            }
            renderEditor();
        }
    });

    screen.key(['left'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorCol > 0) cursorCol--;
            renderEditor();
        }
    });

    screen.key(['right'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
            if (cursorCol < editorContent[cursorRow].length) cursorCol++;
            renderEditor();
        }
    });

    // Ctrl+S to save file
    screen.key(['C-s'], () => {
        if (activePanel === 'editor' && editorFilename) {
            try {
                fs.writeFileSync(editorFilename, editorContent.join('\n'));
                modified = false;
                // Show save message briefly
                editorBox.setLabel(` Saved: ${path.basename(editorFilename)} `);
                renderEditor();
                setTimeout(() => {
                    editorBox.setLabel(' Editor ');
                    renderEditor();
                }, 1500);
            } catch (e: any) {
                editorBox.setLabel(` Error: ${e.message} `);
                screen.render();
            }
        }
    });

    // Quit
    screen.key(['q'], () => {
        if ((activePanel === 'chat' && chatMode === 'normal') ||
            (activePanel === 'editor' && editorMode === 'normal')) {
            process.exit(0);
        }
    });

    // Alt+T: Open embedded terminal
    screen.key(['M-t'], () => {
        const { spawn } = require('child_process');
        let terminalOutput = '';
        let terminalCmd = '';

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
            height: '100%-5',  // Leave room for input
            parent: termContainer,
            style: { fg: 'white' },
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            mouse: true,  // Enable mouse wheel scrolling
            scrollbar: { ch: '█', style: { fg: 'magenta' } }
        });

        // Command input - at bottom of container (NOT scrollable part)
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
        let terminalOpen = true;  // Flag to block other shortcuts

        const runCommand = (cmd: string) => {
            terminalOutput += `{cyan-fg}$ ${cmd}{/cyan-fg}\n`;
            termBox.setContent(terminalOutput + '{gray-fg}Running...{/gray-fg}');
            screen.render();

            const { exec } = require('child_process');

            // Use cmd.exe with proper error capture
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
            if (activePanel === 'chat') {
                chatBox.focus();
            } else {
                editorBox.focus();
            }
            renderEditor();
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

    // Ctrl+F to attach file
    screen.key(['C-f'], () => {
        if (activePanel !== 'chat' || chatMode !== 'normal') return;

        let currentDir = process.cwd();
        const fileList = blessed.box({
            top: 'center',
            left: 'center',
            width: '70%',
            height: '60%',
            label: ` Attach File (j/k=nav, Enter=select, ESC=cancel) `,
            border: { type: 'line' },
            style: { border: { fg: 'green' }, bg: 'black' },
            scrollable: true,
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
                if (parent !== dir) items.push({ name: '..', isDir: true, fullPath: parent });
                const allFiles = fs.readdirSync(dir);
                const dirs = allFiles.filter(f => { try { return fs.statSync(path.join(dir, f)).isDirectory() && !f.startsWith('.'); } catch { return false; } });
                const files = allFiles.filter(f => { try { return fs.statSync(path.join(dir, f)).isFile() && !f.startsWith('.'); } catch { return false; } });
                dirs.sort().forEach(d => items.push({ name: d, isDir: true, fullPath: path.join(dir, d) }));
                files.sort().forEach(f => items.push({ name: f, isDir: false, fullPath: path.join(dir, f) }));
            } catch (e) { }
            renderFileList();
        };

        const renderFileList = () => {
            let content = '';
            items.forEach((item, i) => {
                const prefix = i === selectedIndex ? '{cyan-bg}{black-fg}> ' : '  ';
                const suffix = i === selectedIndex ? ' {/black-fg}{/cyan-bg}' : '';
                const icon = item.isDir ? '{yellow-fg}[DIR]{/yellow-fg} ' : '{green-fg}[FILE]{/green-fg} ';
                content += `${prefix}${icon}${item.name}${suffix}\n`;
            });
            fileList.setContent(content);
            fileList.setLabel(` ${currentDir} `);
            screen.render();
        };

        screen.append(fileList);
        fileList.focus();
        loadDir(currentDir);

        fileList.key(['j', 'down'], () => { selectedIndex = Math.min(selectedIndex + 1, items.length - 1); renderFileList(); });
        fileList.key(['k', 'up'], () => { selectedIndex = Math.max(selectedIndex - 1, 0); renderFileList(); });
        fileList.key(['enter'], () => {
            const item = items[selectedIndex];
            if (!item) return;
            if (item.isDir) {
                loadDir(item.fullPath);
            } else {
                try {
                    attachedFile = fs.readFileSync(item.fullPath, 'utf-8');
                    attachedFileName = item.name;
                    chatContent += `{yellow-fg}[Attached: ${item.name} (${attachedFile.length} chars)]{/yellow-fg}\n\n`;
                    chatBox.setContent(chatContent);
                    chatBox.setScrollPerc(100);
                } catch (e) { }
                screen.remove(fileList);
                chatBox.focus();
                screen.render();
            }
        });
        fileList.key(['escape', 'q'], () => { screen.remove(fileList); chatBox.focus(); screen.render(); });
    });

    // Go back to chatbox mode (Ctrl+B)
    screen.key(['C-b'], async () => {
        if ((activePanel === 'chat' && chatMode === 'normal') ||
            (activePanel === 'editor' && editorMode === 'normal')) {
            configStore.saveConversation(conversation);
            screen.destroy();
            const { vimChatCommand } = await import('./vim-chat');
            await vimChatCommand({ conversation: conversation });
        }
    });

    // Ctrl+S to save editor
    screen.key(['C-s'], () => {
        if (activePanel === 'editor') {
            saveEditorFile();
        }
    });

    // Alt+Left: Expand right panel (editor) by 10%
    screen.key(['M-left'], () => {
        if (splitRatio > 20) {
            splitRatio -= 10;
            resizePanels();
        }
    });

    // Alt+Right: Shrink right panel (editor) by 10%
    screen.key(['M-right'], () => {
        if (splitRatio < 80) {
            splitRatio += 10;
            resizePanels();
        }
    });

    // Ctrl+X: Save As (to different directory)
    screen.key(['C-x'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
            let currentDir = process.cwd();

            const showSaveAsBrowser = () => {
                const entries: { name: string, isDir: boolean }[] = [];
                entries.push({ name: '..', isDir: true });

                try {
                    const items = fs.readdirSync(currentDir);
                    for (const item of items) {
                        try {
                            const stat = fs.statSync(path.join(currentDir, item));
                            if (stat.isDirectory() && !item.startsWith('.')) {
                                entries.push({ name: item, isDir: true });
                            }
                        } catch { }
                    }
                } catch { }

                const dirList = blessed.list({
                    top: 'center',
                    left: 'center',
                    width: '70%',
                    height: '50%',
                    label: ` Save As: ${currentDir} `,
                    border: { type: 'line' },
                    style: {
                        border: { fg: 'green' },
                        selected: { bg: 'green', fg: 'black' }
                    },
                    keys: true,
                    vi: true,
                    mouse: true,
                    items: ['[SAVE HERE]', ...entries.map(e => e.isDir ? `[DIR] ${e.name}` : e.name)]
                });

                screen.append(dirList);
                dirList.focus();
                screen.render();

                dirList.key(['enter'], () => {
                    const idx = (dirList as any).selected as number;

                    if (idx === 0) {
                        // Save here - prompt for filename
                        screen.remove(dirList);

                        const filenameBox = blessed.textbox({
                            top: 'center',
                            left: 'center',
                            width: '60%',
                            height: 3,
                            label: ` Filename (Enter=save, Esc=cancel) `,
                            border: { type: 'line' },
                            style: { border: { fg: 'green' }, bg: 'black', fg: 'white' },
                            inputOnFocus: true
                        });
                        screen.append(filenameBox);
                        filenameBox.focus();
                        screen.render();

                        filenameBox.key(['enter'], () => {
                            const fn = filenameBox.getValue().trim();
                            if (fn) {
                                const newPath = path.join(currentDir, fn);
                                try {
                                    const content = editorContent.join('\n');
                                    fs.writeFileSync(newPath, content);
                                    editorFilename = newPath;
                                    modified = false;
                                    editorBox.setLabel(` Editor [${fn}] `);
                                    editorStatus.setContent(`Saved: ${newPath}`);

                                    // Attach to chatbox
                                    const truncated = content.length > 5000 ? content.slice(0, 5000) + '\n...(truncated)' : content;
                                    chatContent += `{yellow-fg}[Saved As: ${fn}]{/yellow-fg}\n\n`;
                                    conversation.messages.push({
                                        role: 'user',
                                        content: `[Saved File: ${fn}]\n\`\`\`\n${truncated}\n\`\`\``,
                                        timestamp: Date.now()
                                    });
                                    chatBox.setContent(chatContent);
                                    chatBox.setScrollPerc(100);
                                } catch {
                                    editorStatus.setContent(`{red-fg}Error saving{/red-fg}`);
                                }
                            }
                            screen.remove(filenameBox);
                            editorBox.focus();
                            renderEditor();
                        });

                        filenameBox.key(['escape'], () => {
                            screen.remove(filenameBox);
                            editorBox.focus();
                            renderEditor();
                        });
                    } else {
                        const entry = entries[idx - 1];
                        if (entry.isDir) {
                            screen.remove(dirList);
                            if (entry.name === '..') {
                                currentDir = path.dirname(currentDir);
                            } else {
                                currentDir = path.join(currentDir, entry.name);
                            }
                            showSaveAsBrowser();
                        }
                    }
                });

                dirList.key(['h'], () => {
                    screen.remove(dirList);
                    currentDir = path.dirname(currentDir);
                    showSaveAsBrowser();
                });

                dirList.key(['escape'], () => {
                    screen.remove(dirList);
                    editorBox.focus();
                    renderEditor();
                });
            };

            showSaveAsBrowser();
        }
    });

    // Ctrl+F to open file in editor
    screen.key(['C-f'], () => {
        if (activePanel === 'editor' && editorMode === 'normal') {
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
                } catch { return; }

                const fileList = blessed.list({
                    top: 'center',
                    left: 'center',
                    width: '70%',
                    height: '60%',
                    label: ` ${currentDir} `,
                    border: { type: 'line' },
                    style: {
                        border: { fg: 'cyan' },
                        selected: { bg: 'cyan', fg: 'black' }
                    },
                    keys: true,
                    vi: true,
                    mouse: true,
                    items: entries.map(e => e.isDir ? `[DIR] ${e.name}` : e.name)
                });

                screen.append(fileList);
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
                            const fileContent = fs.readFileSync(filePath, 'utf-8');
                            editorContent = fileContent.split('\n');
                            editorFilename = filePath;
                            cursorRow = 0;
                            cursorCol = 0;
                            scrollTop = 0;
                            modified = false;
                            editorBox.setLabel(` Editor [${entry.name}] `);

                            // Also attach to chatbox
                            const truncated = fileContent.length > 5000 ? fileContent.slice(0, 5000) + '\n...(truncated)' : fileContent;
                            chatContent += `{green-fg}[Attached: ${entry.name}]{/green-fg}\n\n`;
                            conversation.messages.push({
                                role: 'user',
                                content: `[File: ${entry.name}]\n\`\`\`\n${truncated}\n\`\`\``,
                                timestamp: Date.now()
                            });
                            chatBox.setContent(chatContent);
                        } catch { }
                        screen.remove(fileList);
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
                    editorBox.focus();
                    renderEditor();
                });
            };

            showFileBrowser();
        }
    });

    // Editor keypress handler for insert mode
    screen.on('keypress', (ch: string, key: any) => {
        if (activePanel !== 'editor' || !key) return;

        if (editorMode === 'insert') {
            if (key.name === 'backspace') {
                if (cursorCol > 0) {
                    const line = editorContent[cursorRow];
                    editorContent[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
                    cursorCol--;
                    modified = true;
                } else if (cursorRow > 0) {
                    const prevLen = editorContent[cursorRow - 1].length;
                    editorContent[cursorRow - 1] += editorContent[cursorRow];
                    editorContent.splice(cursorRow, 1);
                    cursorRow--;
                    cursorCol = prevLen;
                    modified = true;
                }
                renderEditor();
                return;
            } else if (key.name === 'enter') {
                const line = editorContent[cursorRow];
                editorContent[cursorRow] = line.slice(0, cursorCol);
                editorContent.splice(cursorRow + 1, 0, line.slice(cursorCol));
                cursorRow++;
                cursorCol = 0;
                modified = true;
                renderEditor();
                return;
            } else if (key.name === 'left') {
                if (cursorCol > 0) cursorCol--;
                renderEditor();
                return;
            } else if (key.name === 'right') {
                if (cursorCol < editorContent[cursorRow].length) cursorCol++;
                renderEditor();
                return;
            } else if (key.name === 'up') {
                if (cursorRow > 0) {
                    cursorRow--;
                    cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
                }
                renderEditor();
                return;
            } else if (key.name === 'down') {
                if (cursorRow < editorContent.length - 1) {
                    cursorRow++;
                    cursorCol = Math.min(cursorCol, editorContent[cursorRow].length);
                }
                renderEditor();
                return;
            } else if (key.name === 'tab') {
                // Insert 4 spaces instead of tab character
                const line = editorContent[cursorRow];
                editorContent[cursorRow] = line.slice(0, cursorCol) + '    ' + line.slice(cursorCol);
                cursorCol += 4;
                modified = true;
                renderEditor();
                return;
            } else if (ch && !key.ctrl && !key.meta) {
                const line = editorContent[cursorRow];
                editorContent[cursorRow] = line.slice(0, cursorCol) + ch + line.slice(cursorCol);
                cursorCol++;
                modified = true;
                renderEditor();
            }
        }

        // Normal mode commands
        if (editorMode === 'normal') {
            if (key.name === 'a') {
                editorMode = 'insert';
                if (editorContent[cursorRow].length > 0) cursorCol++;
                renderEditor();
                updateStatus();
            } else if (ch === 'o') {
                editorContent.splice(cursorRow + 1, 0, '');
                cursorRow++;
                cursorCol = 0;
                editorMode = 'insert';
                modified = true;
                renderEditor();
                updateStatus();
            } else if (ch === 'O') {
                editorContent.splice(cursorRow, 0, '');
                cursorCol = 0;
                editorMode = 'insert';
                modified = true;
                renderEditor();
                updateStatus();
            } else if (ch === 'x') {
                const line = editorContent[cursorRow];
                if (line.length > 0 && cursorCol < line.length) {
                    editorContent[cursorRow] = line.slice(0, cursorCol) + line.slice(cursorCol + 1);
                    if (cursorCol >= editorContent[cursorRow].length && cursorCol > 0) cursorCol--;
                    modified = true;
                    renderEditor();
                }
            } else if (ch === 'd' && key.name === 'd') {
                // dd - delete line
            } else if (ch === 'G') {
                cursorRow = editorContent.length - 1;
                cursorCol = 0;
                renderEditor();
            } else if (ch === 'g') {
                cursorRow = 0;
                cursorCol = 0;
                renderEditor();
            } else if (ch === '0') {
                cursorCol = 0;
                renderEditor();
            } else if (ch === '$') {
                cursorCol = editorContent[cursorRow].length;
                renderEditor();
            } else if (ch === 'w') {
                // Move to next word
                const line = editorContent[cursorRow];
                let pos = cursorCol;
                while (pos < line.length && /\w/.test(line[pos])) pos++;
                while (pos < line.length && !/\w/.test(line[pos])) pos++;
                cursorCol = pos;
                renderEditor();
            } else if (ch === 'b') {
                // Move to previous word
                const line = editorContent[cursorRow];
                let pos = cursorCol;
                if (pos > 0) pos--;
                while (pos > 0 && !/\w/.test(line[pos])) pos--;
                while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
                cursorCol = pos;
                renderEditor();
            }
        }
    });

    screen.key(['C-c'], () => process.exit(0));

    screen.render();
}
