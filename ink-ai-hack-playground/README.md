# Ink Playground

React + TypeScript + Vite prototyping app for interactive ink-based elements
with handwriting recognition.

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
npm install
```

### Environment Setup
Copy the example env file and configure:
```bash
cp .env.example .env.local
```

Required variables:
| Variable | Description |
|----------|-------------|
| `INK_RECOGNITION_API_URL` | Handwriting recognition API endpoint |
| `INK_FAL_AI_API_KEY` | fal.ai key for sketch-to-image (optional — falls back to mock) |

### Running
```bash
npm run dev      # Start dev server (http://localhost:5173)
npm run build    # TypeScript compile + Vite production bundle
npm run lint     # ESLint check
npm run preview  # Preview production build locally
```

See the [project README](../README.md) for full architecture and feature documentation.
