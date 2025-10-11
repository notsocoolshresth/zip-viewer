# WhatsApp Chat Viewer

A web-based application for viewing and analyzing exported WhatsApp chat data with full media support and advanced search capabilities.

## Overview

This application allows you to import WhatsApp chat exports (ZIP files) and view them in a clean, WhatsApp-like interface. It processes chat data locally in your browser and stores it securely using IndexedDB for offline access.

## Features

### Core Functionality
- **Import WhatsApp exports**: Support for ZIP files with or without media
- **Local processing**: All data is processed entirely in your browser
- **Offline storage**: Chat data is stored locally using IndexedDB
- **Multiple chat management**: Save and switch between multiple imported chats
- **Media support**: View images, videos, documents, audio files, and stickers

### User Interface
- **WhatsApp-like design**: Familiar dark theme matching WhatsApp's interface
- **Responsive layout**: Works on desktop, tablet, and mobile devices
- **Dual-pane interface**: Chat list sidebar and main conversation view
- **Virtual scrolling**: Efficient rendering of large chat histories

### Search and Navigation
- **Full-text search**: Search through all messages with real-time results
- **Search navigation**: Navigate between search results with previous/next buttons
- **Message highlighting**: Found messages are highlighted in the conversation
- **Quick filtering**: Filter search results as you type

### Media Management
- **Media panel**: Dedicated view for all shared media, links, and documents
- **Category filtering**: Filter by All, Images, Videos, or Documents
- **Image previews**: Click images to view in full-screen modal
- **Document downloads**: Click documents to download them directly
- **Chronological sorting**: Media files are sorted by date (newest first)

### Advanced Features
- **User switching**: Switch between different participants in group chats
- **Message statistics**: View message counts and participant information
- **Lazy loading**: Efficient loading of images and media
- **Theme consistency**: Dark theme throughout the application

## How to Export WhatsApp Chats

### For Android/iPhone:
1. Open WhatsApp and navigate to the chat you want to export
2. Tap the three dots menu (Android) or contact name (iPhone)
3. Select "More" then "Export chat"
4. Choose either:
   - **Include Media**: Exports with images, videos, and other files
   - **Without Media**: Text-only export (smaller file size)
5. Save the ZIP file to your device

### Supported Export Formats:
- ZIP files containing `_chat.txt` (chat log)
- Associated media files (images, videos, documents, audio)
- Both individual and group chat exports

## Getting Started

### Prerequisites
- Modern web browser with JavaScript enabled
- Node.js and npm (for development)

### Installation
```bash
# Clone the repository
git clone https://github.com/notsocoolshresth/zip-viewer

# Navigate to project directory
cd whatsapp-viewer-simple

# Install dependencies
npm install

# Start development server
npm run dev
```

### Usage
1. Open the application in your web browser at http://localhost:3000
2. Click the upload area or drag and drop your WhatsApp export ZIP file
3. Wait for the chat to be processed and parsed
4. Browse messages, search content, and view media

## Technical Architecture

### Frontend Technologies
- **Next.js**: React framework for the user interface
- **TypeScript**: Type-safe JavaScript development
- **React Window**: Virtual scrolling for performance
- **JSZip**: ZIP file processing in the browser

### Data Processing
- **Client-side parsing**: Chat text files are parsed using regex patterns
- **Media extraction**: Binary files are extracted and converted to blob URLs
- **IndexedDB storage**: Persistent local storage for chat data
- **Memory optimization**: Efficient handling of large chat histories

### File Structure
```
src/
├── app/
│   ├── page.tsx          # Main application component
│   ├── globals.css       # Global styles and themes
│   └── layout.tsx        # Application layout
└── public/
    ├── white.jpg         # Placeholder images
    └── eepy.jpg
```

### Key Components

#### Chat Processing
- Parses WhatsApp text format: `[date, time] sender: message`
- Handles various message types: text, media, system messages
- Extracts metadata: timestamps, sender information, attachments

#### Media Handling
- Supports multiple formats: JPEG, PNG, MP4, PDF, MP3, etc.
- Creates blob URLs for browser display
- Implements lazy loading for performance
- Provides download functionality for documents

#### Search Implementation
- Real-time text search across all messages
- Case-insensitive matching
- Result highlighting and navigation
- Search term persistence

#### Storage Management
- IndexedDB for persistent storage
- Chat metadata and binary data
- Efficient querying and retrieval
- Automatic cleanup and management

## Browser Compatibility

### Supported Browsers
- **Chrome**: Version 80+
- **Firefox**: Version 75+
- **Safari**: Version 13+
- **Edge**: Version 80+

### Required Features
- ES6 JavaScript support
- IndexedDB API
- File API and FileReader
- Blob URLs and object URLs

## Performance Considerations

### Optimization Techniques
- **Virtual scrolling**: Only renders visible messages
- **Lazy loading**: Images load as needed
- **Memory management**: Efficient blob URL handling
- **Chunked processing**: Large files processed in segments

### Recommended Limits
- **Chat size**: Up to 100,000 messages
- **Media files**: Up to 500MB total
- **Individual files**: Up to 50MB per file

## Privacy and Security

### Data Handling
- **Local processing**: No data sent to external servers
- **Browser storage**: All data remains on your device
- **No tracking**: No analytics or user tracking
- **Secure**: Standard web security practices

### Data Persistence
- Chat data is stored in your browser's IndexedDB
- Data persists between browser sessions
- Clear browser data to remove stored chats
- No cloud storage or external dependencies

## Troubleshooting

### Common Issues

**Chat won't load**
- Ensure the ZIP file is a valid WhatsApp export
- Check that the file contains `_chat.txt`
- Try exporting the chat again from WhatsApp

**Media not displaying**
- Verify media was included in the export
- Check browser console for error messages
- Ensure sufficient browser storage space

**Performance issues**
- Large chats may take time to process
- Consider using "Without Media" exports for better performance
- Close other browser tabs to free memory

**Search not working**
- Ensure chat has finished loading completely
- Try refreshing the page and reimporting
- Check for special characters in search terms

### Browser Storage Limits
- Most browsers allow 50MB+ for IndexedDB
- Large media files may hit storage limits
- Use browser developer tools to monitor storage usage

## Development

### Project Structure
The application follows Next.js conventions with a single-page app architecture.

### Key Dependencies
- `react-window`: Virtual scrolling implementation
- `jszip`: ZIP file processing
- `next`: React framework

### Building for Production
```bash
# Build the application
npm run build

# Start production server
npm start
```

## License

This project is open source and available under standard licensing terms.

