'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { VariableSizeList as List } from 'react-window'
import JSZip from 'jszip'

interface Message {
  date: string
  time: string
  sender: string
  text: string
  attachment?: Attachment
}

interface Attachment {
  name: string
  type: 'image' | 'video' | 'document' | 'sticker' | 'audio'
  blobUrl: string
  size: number
}

interface SavedChat {
  id: string
  name: string
  timestamp: number
  messageCount: number
  participants: string[]
  zipBlob: Blob
}

// IndexedDB helper functions
const DB_NAME = 'WhatsAppViewerDB'
const DB_VERSION = 1
const STORE_NAME = 'chats'

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

const saveChat = async (chat: SavedChat): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(chat)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

const getAllChats = async (): Promise<SavedChat[]> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

const deleteChat = async (id: string): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Extract chat name from ZIP file name
const extractChatName = (fileName: string): string => {
  // Remove .zip extension
  const nameWithoutExt = fileName.replace(/\.zip$/i, '')
  
  // Try to match "WhatsApp Chat - [Chat Name]" or "WhatsApp Chat with [Chat Name]"
  const patterns = [
    /WhatsApp Chat - (.+)/i,
    /WhatsApp Chat with (.+)/i,
    /WhatsApp (.+)/i,
  ]
  
  for (const pattern of patterns) {
    const match = nameWithoutExt.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }
  
  // If no pattern matches, return the full name without extension
  return nameWithoutExt.trim()
}

export default function Home() {
  const [containerHeight, setContainerHeight] = useState(600)
  const [allMessages, setAllMessages] = useState<Message[]>([])
  const [currentUser, setCurrentUser] = useState<string>('')
  const [allSenders, setAllSenders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1)
  const [savedChats, setSavedChats] = useState<SavedChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
  const [currentChatName, setCurrentChatName] = useState<string>('')
  const listRef = useRef<List>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const blobUrls = useRef<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowHeights = useRef<{ [key: number]: number }>({})
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setContainerHeight(rect.height)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [allMessages.length])
  useEffect(() => {
    loadSavedChats()
    return () => {
      blobUrls.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const loadSavedChats = async () => {
    try {
      const chats = await getAllChats()
      setSavedChats(chats.sort((a, b) => b.timestamp - a.timestamp))
    } catch (error) {
      console.error('Error loading saved chats:', error)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' bytes'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
  }

  const getAttachmentType = (filename: string): Attachment['type'] => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
    if (['mp4', 'avi', 'mov', 'webm', 'mkv'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
    if (filename.toLowerCase().includes('sticker')) return 'sticker'
    return 'document'
  }

  const parseMessages = (
    text: string,
    attachmentMap: Map<string, Attachment>
  ): Message[] => {
    const messageRegex = /\[(.*?),\s*(.*?)\]\s*(.*?):\s*/g
    const parsed: Message[] = []
    let lastIndex = 0
    let match

    while ((match = messageRegex.exec(text)) !== null) {
      if (parsed.length > 0) {
        const prevMsg = parsed[parsed.length - 1]
        const msgText = text.substring(lastIndex, match.index).trim()
        const attachmentMatch = msgText.match(
          /<attached: (.+?)>|<Media omitted>/i
        )
        if (attachmentMatch) {
          const fileName = attachmentMatch[1]
          if (fileName && attachmentMap.has(fileName)) {
            prevMsg.attachment = attachmentMap.get(fileName)!
            prevMsg.text = msgText.replace(attachmentMatch[0], '').trim()
          } else {
            prevMsg.text = msgText
          }
        } else {
          prevMsg.text = msgText
        }
      }

      parsed.push({
        date: match[1],
        time: match[2],
        sender: match[3],
        text: '',
      })

      lastIndex = messageRegex.lastIndex
    }

    if (parsed.length > 0) {
      const lastMsg = parsed[parsed.length - 1]
      const msgText = text.substring(lastIndex).trim()
      const attachmentMatch = msgText.match(/<attached: (.+?)>|<Media omitted>/i)
      if (attachmentMatch) {
        const fileName = attachmentMatch[1]
        if (fileName && attachmentMap.has(fileName)) {
          lastMsg.attachment = attachmentMap.get(fileName)!
          lastMsg.text = msgText.replace(attachmentMatch[0], '').trim()
        } else {
          lastMsg.text = msgText
        }
      } else {
        lastMsg.text = msgText
      }
    }

    return parsed
  }

  const processZipFile = async (
    file: Blob,
    fileName: string,
    chatId?: string,
    chatName?: string
  ) => {
    setLoading(true)
    setSearchTerm('')
    setSearchResults([])
    setCurrentSearchIndex(-1)

    try {
      const zip = new JSZip()
      const contents = await zip.loadAsync(file)
      const chatFile = contents.file('_chat.txt')

      if (!chatFile) {
        alert('No _chat.txt file found in zip!')
        setLoading(false)
        return
      }

      blobUrls.current.forEach(url => URL.revokeObjectURL(url))
      blobUrls.current = []

      const attachmentMap = new Map<string, Attachment>()
      for (const [filename, zipEntry] of Object.entries(contents.files)) {
        if (filename === '_chat.txt' || zipEntry.dir) continue
        const blob = await zipEntry.async('blob')
        const type = getAttachmentType(filename)
        const blobUrl = URL.createObjectURL(blob)
        blobUrls.current.push(blobUrl)
        attachmentMap.set(filename, {
          name: filename,
          type,
          blobUrl,
          size: blob.size,
        })
      }

      const text = await chatFile.async('string')
      const parsed = parseMessages(text, attachmentMap)

      setAllMessages(parsed)
      rowHeights.current = {}

      const senders = [...new Set(parsed.map(m => m.sender))]
      setAllSenders(senders)
      setCurrentUser('')

      // Save to IndexedDB if it's a new upload
      if (!chatId) {
        const newChatId = Date.now().toString()
        
        // Extract chat name from file name or use provided name
        const extractedName = chatName || extractChatName(fileName)
        
        const savedChat: SavedChat = {
          id: newChatId,
          name: extractedName,
          timestamp: Date.now(),
          messageCount: parsed.length,
          participants: senders,
          zipBlob: file,
        }

        await saveChat(savedChat)
        await loadSavedChats()
        setCurrentChatId(newChatId)
        setCurrentChatName(savedChat.name)
      } else {
        setCurrentChatId(chatId)
        setCurrentChatName(chatName || '')
      }

      setTimeout(() => {
        if (listRef.current && parsed.length > 0) {
          listRef.current.scrollToItem(parsed.length - 1, 'end')
        }
      }, 100)
    } catch (error) {
      console.error('Error:', error)
      alert('Error loading chat file')
    } finally {
      setLoading(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processZipFile(file, file.name)
  }

  const loadSavedChat = async (chat: SavedChat) => {
    await processZipFile(chat.zipBlob, chat.name, chat.id, chat.name)
  }

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Are you sure you want to delete this chat?')) {
      try {
        await deleteChat(chatId)
        await loadSavedChats()
        if (currentChatId === chatId) {
          setAllMessages([])
          setCurrentChatId('')
          setCurrentChatName('')
        }
      } catch (error) {
        console.error('Error deleting chat:', error)
        alert('Failed to delete chat')
      }
    }
  }

  const performSearch = () => {
    if (!searchTerm.trim()) {
      setSearchResults([])
      setCurrentSearchIndex(-1)
      return
    }

    const results: number[] = []
    allMessages.forEach((msg, index) => {
      if (
        msg.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.sender.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        results.push(index)
      }
    })

    setSearchResults(results)
    setCurrentSearchIndex(results.length > 0 ? 0 : -1)
    if (results.length > 0) scrollToMessage(results[0])
  }

  const scrollToMessage = (index: number) => {
    if (listRef.current) {
      listRef.current.scrollToItem(index, 'center')
    }
  }

  const nextSearchResult = () => {
    if (searchResults.length === 0) return
    const nextIndex = (currentSearchIndex + 1) % searchResults.length
    setCurrentSearchIndex(nextIndex)
    scrollToMessage(searchResults[nextIndex])
  }

  const prevSearchResult = () => {
    if (searchResults.length === 0) return
    const prevIndex =
      (currentSearchIndex - 1 + searchResults.length) % searchResults.length
    setCurrentSearchIndex(prevIndex)
    scrollToMessage(searchResults[prevIndex])
  }

  const toggleDarkMode = () => setDarkMode(v => !v)

  const getRowHeight = (index: number) => {
    return rowHeights.current[index] || 120
  }

  const setRowHeight = useCallback((index: number, size: number) => {
    if (rowHeights.current[index] !== size) {
      rowHeights.current[index] = size
      listRef.current?.resetAfterIndex(index)
    }
  }, [])

  const renderAttachment = (attachment: Attachment, onLoad: () => void) => {
    switch (attachment.type) {
      case 'image':
        return (
          <img
            src={attachment.blobUrl}
            alt={attachment.name}
            className="attachment-image"
            loading="lazy"
            onLoad={onLoad}
            onError={onLoad}
          />
        )
      case 'video':
        return (
          <video
            src={attachment.blobUrl}
            controls
            className="attachment-video"
            preload="metadata"
            onLoadedMetadata={onLoad}
            onError={onLoad}
          />
        )
      case 'sticker':
        return (
          <img
            src={attachment.blobUrl}
            alt={attachment.name}
            className="attachment-sticker"
            loading="lazy"
            onLoad={onLoad}
            onError={onLoad}
          />
        )
      case 'audio':
        return (
          <audio
            src={attachment.blobUrl}
            controls
            className="attachment-audio"
            preload="metadata"
            onLoadedMetadata={onLoad}
          />
        )
      case 'document':
      default:
        return (
          <div className="attachment-document">
            <div className="document-icon" />
            <div className="document-info">
              <div className="document-name">{attachment.name}</div>
              <div className="document-size">
                {formatFileSize(attachment.size)}
              </div>
            </div>
            <a
              href={attachment.blobUrl}
              download={attachment.name}
              className="document-download"
            >
              Download
            </a>
          </div>
        )
    }
  }

  const MessageRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const msg = allMessages[index]
      const isSent = currentUser && msg.sender === currentUser
      const isCurrentResult = searchResults[currentSearchIndex] === index

      const rowRef = useRef<HTMLDivElement>(null)

      useEffect(() => {
        if (rowRef.current) {
          const height = rowRef.current.getBoundingClientRect().height
          setRowHeight(index, height + 16) // +16 for padding
        }
      }, [])

      const handleMediaLoad = () => {
        if (rowRef.current) {
          const height = rowRef.current.getBoundingClientRect().height
          setRowHeight(index, height + 16)
        }
      }

      return (
        <div
          style={style}
          className={`message-wrapper ${
            isCurrentResult ? 'search-highlight' : ''
          }`}
        >
          <div
            ref={rowRef}
            className={`message ${isSent ? 'sent' : 'received'}`}
          >
            <div className={`bubble ${isSent ? 'sent' : 'received'}`}>
              {!isSent && <div className="sender">{msg.sender}</div>}
              {msg.attachment ? (
                <div className="attachment-container">
                  {renderAttachment(msg.attachment, handleMediaLoad)}
                  {msg.text && (
                    <div className="attachment-caption">{msg.text}</div>
                  )}
                </div>
              ) : (
                <div className="text">{msg.text}</div>
              )}
              <div className="timestamp">{msg.time}</div>
            </div>
          </div>
        </div>
      )
    },
    [allMessages, currentUser, searchResults, currentSearchIndex, setRowHeight]
  )

  const isEmptyState = allMessages.length === 0 && !loading

  return (
    <div className={`app-wrapper ${darkMode ? 'dark-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Chats</h2>
          <div className="sidebar-actions">
            <button
              className="icon-btn"
              aria-label="New chat"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="sidebar-content">
          {savedChats.length === 0 ? (
            <div className="empty-sidebar">
              <div className="empty-icon" />
              <p className="empty-title">No saved chats yet</p>
              <p className="empty-subtitle">
                Upload a WhatsApp export to get started
              </p>
            </div>
          ) : (
            <div className="chat-list">
              {savedChats.map(chat => (
                <div
                  key={chat.id}
                  className={`chat-item ${
                    currentChatId === chat.id ? 'active' : ''
                  }`}
                  onClick={() => loadSavedChat(chat)}
                >
                  <div className="chat-avatar">
                    {chat.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="chat-details">
                    <div className="chat-name">{chat.name}</div>
                    <div className="chat-meta">
                      {chat.messageCount} messages • {chat.participants.length}{' '}
                      {chat.participants.length === 1
                        ? 'participant'
                        : 'participants'}
                    </div>
                    <div className="chat-date">
                      {new Date(chat.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteChat(chat.id, e)}
                    aria-label="Delete chat"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        {isEmptyState ? (
          <div className="empty-state">
            <div className="empty-hero">
              <div className="hero-icon" />
              <h1>WhatsApp Chat Viewer</h1>
              <p>Import and view your exported WhatsApp chats</p>
            </div>

            <label className="dropzone" htmlFor="file-upload">
              <input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFile}
                disabled={loading}
                style={{ display: 'none' }}
              />
              <div className="upload-icon" />
              <h2>Drop your WhatsApp export here</h2>
              <p>or click to browse for a ZIP file</p>
            </label>

            <div className="instructions">
              <h3>How to export your WhatsApp chat:</h3>
              <ol>
                <li>Open WhatsApp and go to the chat you want to export</li>
                <li>Tap the three dots menu → More → Export chat</li>
                <li>Choose "Include Media" or "Without Media"</li>
                <li>Save the ZIP file and upload it here</li>
              </ol>
              <p className="privacy-note">
                Your chats are processed locally in your browser and stored
                securely in IndexedDB
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <div className="chat-info">
                <h2>{currentChatName || 'Chat Messages'}</h2>
              </div>
              <div className="header-controls">
                <div className="search-container">
                  <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && performSearch()}
                    className="search-input"
                  />
                  {searchResults.length > 0 && (
                    <div className="search-navigation">
                      <span>
                        {currentSearchIndex + 1} of {searchResults.length}
                      </span>
                      <button onClick={prevSearchResult} className="nav-button">
                        ←
                      </button>
                      <button onClick={nextSearchResult} className="nav-button">
                        →
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={toggleDarkMode} className="theme-toggle">
                  {darkMode ? '☀' : '🌙'}
                </button>
              </div>
            </div>

            {loading && <p className="loading">Loading chat...</p>}

            {allSenders.length > 0 && (
              <div className="user-selector">
                <label>
                  You are:{' '}
                  <select
                    value={currentUser}
                    onChange={(e) => setCurrentUser(e.target.value)}
                  >
                    <option value="">Not in this chat (view only)</option>
                    {allSenders.map(sender => (
                      <option key={sender} value={sender}>
                        {sender}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="message-counter">
                  {allMessages.length} messages
                </span>
              </div>
            )}

      <div className="messages-container" ref={containerRef}>
        <List
          ref={listRef}
          height={containerHeight}
          itemCount={allMessages.length}
          itemSize={getRowHeight}
          width="100%"
          overscanCount={5}
        >
          {MessageRow}
        </List>
      </div>
          </>
        )}
      </main>
    </div>
  )
}