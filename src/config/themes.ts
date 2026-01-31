// Theme definitions for vim-chat

export interface Theme {
    name: string;
    border: string;
    borderFocus: string;
    text: string;
    bg: string;
    highlight: string;
    ai: string;
    error: string;
    status: {
        fg: string;
        bg: string;
    };
}

export const themes: Record<string, Theme> = {
    dark: {
        name: 'Dark',
        border: 'cyan',
        borderFocus: 'yellow',
        text: 'white',
        bg: 'black',
        highlight: 'cyan',
        ai: 'cyan',
        error: 'red',
        status: { fg: 'black', bg: 'cyan' }
    },
    light: {
        name: 'Light',
        border: 'blue',
        borderFocus: 'magenta',
        text: 'black',
        bg: 'white',
        highlight: 'blue',
        ai: 'blue',
        error: 'red',
        status: { fg: 'white', bg: 'blue' }
    },
    cyberpunk: {
        name: 'Cyberpunk',
        border: 'magenta',
        borderFocus: 'cyan',
        text: 'white',
        bg: 'black',
        highlight: 'magenta',
        ai: 'magenta',
        error: 'red',
        status: { fg: 'black', bg: 'magenta' }
    },
    monokai: {
        name: 'Monokai',
        border: 'yellow',
        borderFocus: 'green',
        text: 'white',
        bg: 'black',
        highlight: 'yellow',
        ai: 'green',
        error: 'red',
        status: { fg: 'black', bg: 'yellow' }
    },
    ocean: {
        name: 'Ocean',
        border: 'blue',
        borderFocus: 'cyan',
        text: 'white',
        bg: 'black',
        highlight: 'blue',
        ai: 'cyan',
        error: 'red',
        status: { fg: 'white', bg: 'blue' }
    },
    forest: {
        name: 'Forest',
        border: 'green',
        borderFocus: 'yellow',
        text: 'white',
        bg: 'black',
        highlight: 'green',
        ai: 'green',
        error: 'red',
        status: { fg: 'black', bg: 'green' }
    },
    sunset: {
        name: 'Sunset',
        border: 'yellow',
        borderFocus: 'red',
        text: 'white',
        bg: 'black',
        highlight: 'yellow',
        ai: 'yellow',
        error: 'red',
        status: { fg: 'black', bg: 'yellow' }
    },
    dracula: {
        name: 'Dracula',
        border: 'magenta',
        borderFocus: 'green',
        text: 'white',
        bg: 'black',
        highlight: 'magenta',
        ai: 'cyan',
        error: 'red',
        status: { fg: 'white', bg: 'magenta' }
    },
    gruvbox: {
        name: 'Gruvbox',
        border: 'yellow',
        borderFocus: 'cyan',
        text: 'white',
        bg: 'black',
        highlight: 'yellow',
        ai: 'green',
        error: 'red',
        status: { fg: 'black', bg: 'yellow' }
    },
    nord: {
        name: 'Nord',
        border: 'cyan',
        borderFocus: 'blue',
        text: 'white',
        bg: 'black',
        highlight: 'cyan',
        ai: 'blue',
        error: 'red',
        status: { fg: 'black', bg: 'cyan' }
    }
};

export const themeNames = Object.keys(themes);

export function getTheme(name: string): Theme {
    return themes[name] || themes.dark;
}
