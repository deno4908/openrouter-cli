<p align="center">
  <img src="https://img.shields.io/npm/v/deno-openrouter-cli?style=for-the-badge&color=00d4ff" alt="npm version"/>
  <img src="https://img.shields.io/npm/l/deno-openrouter-cli?style=for-the-badge&color=green" alt="license"/>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge" alt="node"/>
  <img src="https://img.shields.io/npm/dt/deno-openrouter-cli?style=for-the-badge&color=orange" alt="downloads"/>
</p>

<h1 align="center">🚀 Deno OpenRouter CLI</h1>

<p align="center">
  <strong>A powerful terminal-based AI chat application with Vim-style keybindings</strong>
</p>

<p align="center">
  Chat with 100+ free AI models • Split view editor • Embedded terminal • Multi-key rotation
</p>

---

## 📖 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Commands](#-commands)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [API Key Setup](#-api-key-setup)
- [Configuration](#-configuration)
- [Modes](#-modes)
- [Tips & Tricks](#-tips--tricks)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### 🎯 Core Features
| Feature | Description |
|---------|-------------|
| **Vim Keybindings** | Navigate like a pro with `j/k`, `i`, `ESC`, `G/g` |
| **100+ Free Models** | Access Llama, Gemma, Mistral, and more |
| **Conversation History** | Save, continue, rename, delete, fork conversations |
| **Theme Support** | 4 built-in themes: Dark, Light, Cyberpunk, Matrix |

### 📝 Editor Features
| Feature | Description |
|---------|-------------|
| **Split View** | Side-by-side chat + code editor |
| **Syntax Highlighting** | Automatic language detection |
| **File Browser** | Browse and open files with `Ctrl+O` |
| **Auto Save** | Save with `Ctrl+S` |

### 🔧 Advanced Features
| Feature | Description |
|---------|-------------|
| **Multi API Keys** | Add multiple keys, auto-rotation |
| **Parallel Validation** | Validate all keys simultaneously |
| **Embedded Terminal** | Run shell commands with `Alt+T` |
| **File Attachment** | Send code files to AI with `Ctrl+F` |
| **System Prompts** | Set custom AI personality with `s` |
| **Clipboard** | Copy AI responses with `y` |

---

## 📦 Installation

### NPM (Recommended)
```bash
npm install -g deno-openrouter-cli
```

### From Source
```bash
git clone https://github.com/denoplayground/deno-openrouter-cli.git
cd deno-openrouter-cli
npm install
npm run build
npm link
```

### 📱 Termux (Android)
```bash
# Install Node.js in Termux
pkg update && pkg install nodejs

# Install the CLI
npm install -g deno-openrouter-cli

# Run with Termux mode (keeps keyboard open)
openrouter chat --termux
# or
or chat -t
```

**Note**: Use `--termux` or `-t` flag to enable mobile-friendly mode that keeps the virtual keyboard open.

---

## 🚀 Quick Start

```bash
# Start the main chat interface
openrouter chat

# Or use the short alias
or chat
```

On first run, you'll be prompted to add your API key(s).

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `or chat` | Start Vim-style chat interface |
| `or split` | Split view: chat + code editor |
| `or edit -f <file>` | Open file in terminal editor |
| `or models` | List available AI models |
| `or config show` | View current configuration |
| `or config set-key <key>` | Set API key |
| `or config set-model <id>` | Set default model |
| `or history list` | View conversation history |
| `or history show <id>` | View specific conversation |
| `or history clear` | Clear all history |

---

## ⌨️ Keyboard Shortcuts

### 🔹 Normal Mode (Navigation)
| Key | Action |
|-----|--------|
| `i` | Enter insert mode (type message) |
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `G` | Jump to bottom |
| `g` | Jump to top |
| `Tab` | Toggle shortcuts panel |

### 🔹 Insert Mode
| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `ESC` | Exit to normal mode |

### 🔹 Chat Management
| Key | Action |
|-----|--------|
| `m` | Select AI model |
| `n` | New conversation |
| `c` | Conversation list |
| `t` | Rename conversation |
| `p` | Pin/unpin conversation |
| `x` | Clear chat |
| `d` | Delete conversation |

### 🔹 File Operations
| Key | Action |
|-----|--------|
| `Ctrl+F` | Attach file to message |
| `Ctrl+O` | Open file browser |
| `e` | Open code editor |
| `Ctrl+S` | Open split view |

### 🔹 Utilities
| Key | Action |
|-----|--------|
| `y` | Copy last AI response |
| `/` | Search in chat |
| `s` | Set system prompt |
| `S-h` | Toggle history context |
| `Alt+T` | Open embedded terminal |
| `Ctrl+T` | Change theme |
| `Ctrl+B` | Back to main chat |
| `q` | Quit |

---

## 🔐 API Key Setup

### First Run Setup
On first run, you'll see the key management screen:

```
┌─ API Key Management ──────────────────────────────┐
│ API Keys configured: 3                            │
│                                                   │
│ Get your free key at: https://openrouter.ai/keys  │
│                                                   │
│ Current Keys:                                     │
│   1. sk-or-v1-abc12...xyz89                       │
│   2. sk-or-v1-def34...uvw67                       │
│                                                   │
│ Commands:                                         │
│   a - Add key(s), comma separated                 │
│   v - Validate all keys (parallel)                │
│   d - Delete last key                             │
│   Enter - Continue                                │
└───────────────────────────────────────────────────┘
```

### Get Your Free Key
1. Go to https://openrouter.ai/keys
2. Sign up or login
3. Create a new key
4. Copy and paste into the CLI

### Multiple Keys
You can add multiple keys for:
- **Load balancing**: Distribute requests across keys
- **Rate limit bypass**: Switch keys when one is rate limited
- **Backup**: Fallback if a key expires

---

## 🎨 Modes

### Chat Mode (`or chat`)
Full-screen Vim-style chat interface with:
- Scrollable chat history
- Shortcuts sidebar
- Status bar showing mode and model

### Split Mode (`or split` or `Ctrl+S`)
Two-panel layout:
- **Left**: Chat interface
- **Right**: Code editor with syntax highlighting

### Editor Mode (`or edit` or `e`)
Terminal-based code editor with:
- Vim keybindings
- Line numbers
- Save/load files

---

## ⚙️ Configuration

### Environment Variables
Create a `.env` file in your project:
```env
OPENROUTER_API_KEYS=key1,key2,key3
```

### Config File
Configuration is stored automatically. View with:
```bash
or config show
```

### Available Settings
| Setting | Description |
|---------|-------------|
| `apiKey` | Primary API key |
| `defaultModel` | Default AI model ID |
| `theme` | Color theme (dark/light/cyberpunk/matrix) |
| `defaultSystemPrompt` | Default personality for AI |

---

## 💡 Tips & Tricks

### 1. Fast Model Switching
Press `m` in normal mode to quickly switch between models.

### 2. Code Review
Use `Ctrl+F` to attach code files, then ask AI to review/explain.

### 3. Quick Commands
Use embedded terminal (`Alt+T`) to run commands without leaving chat.

### 4. Conversation Fork
Press `o` to fork a conversation and try different approaches.

### 5. System Prompts
Press `s` to set custom personality:
- "You are a Python expert"
- "Explain like I'm 5"
- "Be concise and use code examples"

---

## 🤝 Contributing

Contributions are welcome! 

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 📄 License

MIT © [deno4908](https://github.com/deno4908)

---

<p align="center">
  Made with ❤️ for terminal enthusiasts
</p>

<p align="center">
  <a href="https://github.com/deno4908/openrouter-cli">⭐ Star on GitHub</a>
</p>
