import blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { getTheme } from '../config/themes';
import { configStore } from '../config/store';

interface EditorState {
    content: string[];
    cursorRow: number;
    cursorCol: number;
    scrollTop: number;
    mode: 'normal' | 'insert' | 'command';
    filename: string;
    modified: boolean;
    searchTerm: string;
    commandBuffer: string;
}

export async function editorCommand(options: { file?: string }) {
    console.clear();

    const currentTheme = getTheme(configStore.getTheme());

    const screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
        title: 'Editor'
    });

    // Detect Termux (Android terminal) to keep keyboard open
    const isTermux = process.env.TERMUX_VERSION !== undefined ||
        process.env.PREFIX?.includes('com.termux') ||
        process.platform === 'android';

    const state: EditorState = {
        content: [''],
        cursorRow: 0,
        cursorCol: 0,
        scrollTop: 0,
        mode: 'normal',
        filename: options.file || '',
        modified: false,
        searchTerm: '',
        commandBuffer: ''
    };

    // Load file if provided
    if (options.file && fs.existsSync(options.file)) {
        try {
            const fileContent = fs.readFileSync(options.file, 'utf-8');
            state.content = fileContent.split('\n');
            if (state.content.length === 0) state.content = [''];
        } catch (e) {
            state.content = ['// Error loading file'];
        }
    }

    // Main editor area
    const editorBox = blessed.box({
        top: 0,
        left: 0,
        width: '100%',
        height: '100%-2',
        style: { fg: 'white', bg: 'black' },
        tags: true
    });

    // Status bar
    const statusBar = blessed.box({
        bottom: 1,
        left: 0,
        width: '100%',
        height: 1,
        style: { fg: 'black', bg: 'white' }
    });

    // Command line
    const cmdLine = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        style: { fg: 'white', bg: 'black' },
        tags: true
    });

    screen.append(editorBox);
    screen.append(statusBar);
    screen.append(cmdLine);

    // On Termux, create hidden input to trigger and keep keyboard open
    if (isTermux) {
        const hiddenInput = blessed.textbox({
            top: -1,
            left: 0,
            width: 1,
            height: 1,
            inputOnFocus: true
        });
        screen.append(hiddenInput);
        hiddenInput.focus();
        hiddenInput.readInput();
    }

    const visibleLines = () => Math.floor((screen.height as number) - 3);

    const updateStatus = () => {
        const modeStr = state.mode.toUpperCase();
        const modified = state.modified ? '[+]' : '';
        const pos = `${state.cursorRow + 1}:${state.cursorCol + 1}`;
        const file = state.filename || '[No File]';
        statusBar.setContent(` ${modeStr} | ${file} ${modified} | ${pos} | :w=save :q=quit /=search`);
    };

    const render = () => {
        let display = '';
        const height = visibleLines();

        // Adjust scroll if cursor out of view
        if (state.cursorRow < state.scrollTop) {
            state.scrollTop = state.cursorRow;
        } else if (state.cursorRow >= state.scrollTop + height) {
            state.scrollTop = state.cursorRow - height + 1;
        }

        for (let i = 0; i < height; i++) {
            const lineNum = state.scrollTop + i;
            if (lineNum >= state.content.length) {
                display += `{gray-fg}~{/gray-fg}\n`;
                continue;
            }

            const lineNumStr = String(lineNum + 1).padStart(4, ' ');
            let line = state.content[lineNum] || '';

            // Highlight cursor position
            if (lineNum === state.cursorRow) {
                const before = line.slice(0, state.cursorCol);
                const cursor = line[state.cursorCol] || ' ';
                const after = line.slice(state.cursorCol + 1);
                line = `${before}{black-bg}{white-fg}${cursor}{/white-fg}{/black-bg}${after}`;
            }

            // Search highlight
            if (state.searchTerm && line.includes(state.searchTerm)) {
                line = line.replace(new RegExp(state.searchTerm, 'g'), `{yellow-bg}{black-fg}${state.searchTerm}{/black-fg}{/yellow-bg}`);
            }

            display += `{gray-fg}${lineNumStr}{/gray-fg} ${line}\n`;
        }

        editorBox.setContent(display);
        updateStatus();

        if (state.mode === 'command') {
            cmdLine.setContent(`:${state.commandBuffer}`);
        } else if (state.searchTerm) {
            cmdLine.setContent(`/${state.searchTerm}`);
        } else {
            cmdLine.setContent('');
        }

        screen.render();
    };

    const saveFile = () => {
        if (!state.filename) {
            cmdLine.setContent('{red-fg}No filename! Use :w filename{/red-fg}');
            screen.render();
            return false;
        }
        try {
            fs.writeFileSync(state.filename, state.content.join('\n'));
            state.modified = false;
            cmdLine.setContent(`{green-fg}Saved: ${state.filename}{/green-fg}`);
            screen.render();
            return true;
        } catch (e) {
            cmdLine.setContent('{red-fg}Error saving file{/red-fg}');
            screen.render();
            return false;
        }
    };

    const executeCommand = (cmd: string) => {
        const parts = cmd.trim().split(' ');
        const command = parts[0];
        const arg = parts.slice(1).join(' ');

        switch (command) {
            case 'w':
                if (arg) state.filename = arg;
                saveFile();
                break;
            case 'q':
                if (state.modified) {
                    cmdLine.setContent('{red-fg}Unsaved changes! Use :q! to force quit{/red-fg}');
                    screen.render();
                } else {
                    screen.destroy();
                    process.exit(0);
                }
                break;
            case 'q!':
                screen.destroy();
                process.exit(0);
                break;
            case 'wq':
                if (saveFile()) {
                    screen.destroy();
                    process.exit(0);
                }
                break;
            case 'e':
                if (arg && fs.existsSync(arg)) {
                    state.filename = arg;
                    state.content = fs.readFileSync(arg, 'utf-8').split('\n');
                    state.cursorRow = 0;
                    state.cursorCol = 0;
                    state.modified = false;
                }
                break;
            case 'new':
                state.filename = arg || '';
                state.content = [''];
                state.cursorRow = 0;
                state.cursorCol = 0;
                state.modified = false;
                break;
            default:
                // Try to parse as line number
                const lineNum = parseInt(command);
                if (!isNaN(lineNum)) {
                    state.cursorRow = Math.min(Math.max(0, lineNum - 1), state.content.length - 1);
                    state.cursorCol = 0;
                }
        }
        state.mode = 'normal';
        state.commandBuffer = '';
        render();
    };

    const findNext = () => {
        if (!state.searchTerm) return;

        for (let i = state.cursorRow; i < state.content.length; i++) {
            const line = state.content[i];
            const startCol = i === state.cursorRow ? state.cursorCol + 1 : 0;
            const idx = line.indexOf(state.searchTerm, startCol);
            if (idx !== -1) {
                state.cursorRow = i;
                state.cursorCol = idx;
                render();
                return;
            }
        }
        // Wrap around
        for (let i = 0; i <= state.cursorRow; i++) {
            const line = state.content[i];
            const idx = line.indexOf(state.searchTerm);
            if (idx !== -1) {
                state.cursorRow = i;
                state.cursorCol = idx;
                render();
                return;
            }
        }
    };

    // Handle all key input
    screen.on('keypress', (ch: string, key: any) => {
        if (!key) return;

        // Command mode
        if (state.mode === 'command') {
            if (key.name === 'enter') {
                executeCommand(state.commandBuffer);
            } else if (key.name === 'escape') {
                state.mode = 'normal';
                state.commandBuffer = '';
                render();
            } else if (key.name === 'backspace') {
                state.commandBuffer = state.commandBuffer.slice(0, -1);
                render();
            } else if (ch && ch.length === 1) {
                state.commandBuffer += ch;
                render();
            }
            return;
        }

        // Insert mode
        if (state.mode === 'insert') {
            if (key.name === 'escape') {
                state.mode = 'normal';
                render();
                return;
            }

            if (key.name === 'enter') {
                const line = state.content[state.cursorRow];
                const before = line.slice(0, state.cursorCol);
                const after = line.slice(state.cursorCol);
                state.content[state.cursorRow] = before;
                state.content.splice(state.cursorRow + 1, 0, after);
                state.cursorRow++;
                state.cursorCol = 0;
                state.modified = true;
                render();
                return;
            }

            if (key.name === 'backspace') {
                if (state.cursorCol > 0) {
                    const line = state.content[state.cursorRow];
                    state.content[state.cursorRow] = line.slice(0, state.cursorCol - 1) + line.slice(state.cursorCol);
                    state.cursorCol--;
                    state.modified = true;
                } else if (state.cursorRow > 0) {
                    const currLine = state.content[state.cursorRow];
                    const prevLine = state.content[state.cursorRow - 1];
                    state.cursorCol = prevLine.length;
                    state.content[state.cursorRow - 1] = prevLine + currLine;
                    state.content.splice(state.cursorRow, 1);
                    state.cursorRow--;
                    state.modified = true;
                }
                render();
                return;
            }

            if (ch && ch.length === 1) {
                const line = state.content[state.cursorRow];
                state.content[state.cursorRow] = line.slice(0, state.cursorCol) + ch + line.slice(state.cursorCol);
                state.cursorCol++;
                state.modified = true;
                render();
                return;
            }
            return;
        }

        // Normal mode
        if (key.ctrl && key.name === 'c') {
            process.exit(0);
        }

        if (key.ctrl && key.name === 's') {
            saveFile();
            return;
        }

        switch (key.name) {
            case 'i':
                state.mode = 'insert';
                render();
                break;
            case 'a':
                state.mode = 'insert';
                state.cursorCol = Math.min(state.cursorCol + 1, state.content[state.cursorRow].length);
                render();
                break;
            case 'o':
                state.content.splice(state.cursorRow + 1, 0, '');
                state.cursorRow++;
                state.cursorCol = 0;
                state.mode = 'insert';
                state.modified = true;
                render();
                break;
            case 'h':
            case 'left':
                state.cursorCol = Math.max(0, state.cursorCol - 1);
                render();
                break;
            case 'l':
            case 'right':
                state.cursorCol = Math.min(state.content[state.cursorRow].length - 1, state.cursorCol + 1);
                render();
                break;
            case 'j':
            case 'down':
                state.cursorRow = Math.min(state.content.length - 1, state.cursorRow + 1);
                state.cursorCol = Math.min(state.cursorCol, state.content[state.cursorRow].length);
                render();
                break;
            case 'k':
            case 'up':
                state.cursorRow = Math.max(0, state.cursorRow - 1);
                state.cursorCol = Math.min(state.cursorCol, state.content[state.cursorRow].length);
                render();
                break;
            case 'g':
                state.cursorRow = 0;
                state.cursorCol = 0;
                render();
                break;
            case 'escape':
                state.searchTerm = '';
                render();
                break;
            case 'n':
                findNext();
                break;
            case 'd':
                // Delete line (dd)
                if (state.content.length > 1) {
                    state.content.splice(state.cursorRow, 1);
                    state.cursorRow = Math.min(state.cursorRow, state.content.length - 1);
                    state.modified = true;
                } else {
                    state.content = [''];
                    state.cursorCol = 0;
                    state.modified = true;
                }
                render();
                break;
        }

        // G for go to end
        if (key.shift && key.name === 'g') {
            state.cursorRow = state.content.length - 1;
            state.cursorCol = 0;
            render();
        }

        // Colon for command mode
        if (ch === ':') {
            state.mode = 'command';
            state.commandBuffer = '';
            render();
        }

        // Slash for search
        if (ch === '/') {
            state.mode = 'command';
            state.commandBuffer = '';
            cmdLine.setContent('/');
            screen.render();

            // Switch to search input mode
            const searchBox = blessed.textbox({
                bottom: 0,
                left: 1,
                width: '100%-1',
                height: 1,
                style: { fg: 'white', bg: 'black' },
                inputOnFocus: true
            });

            screen.append(searchBox);
            searchBox.focus();
            searchBox.readInput();

            searchBox.on('submit', (value: string) => {
                state.searchTerm = value;
                state.mode = 'normal';
                screen.remove(searchBox);
                findNext();
            });

            searchBox.on('cancel', () => {
                state.mode = 'normal';
                screen.remove(searchBox);
                render();
            });
        }
    });

    render();
}

export async function openEditor(screen: any, filename?: string): Promise<void> {
    // This function can be called from chat to open editor overlay
    return new Promise((resolve) => {
        if (filename && fs.existsSync(filename)) {
            screen.destroy();
            editorCommand({ file: filename });
        } else {
            screen.destroy();
            editorCommand({});
        }
    });
}
