'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { VariableSizeList as List } from 'react-window'
import JSZip from 'jszip'
import Image from 'next/image'

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
  thumbnailUrl?: string
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

// Generate thumbnail for images
const generateThumbnail = async (
  blob: Blob,
  maxWidth: number = 200,
  maxHeight: number = 200
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height
          height = maxHeight
        }
      }

      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)

      canvas.toBlob(
        (thumbnailBlob) => {
          if (thumbnailBlob) {
            resolve(URL.createObjectURL(thumbnailBlob))
          } else {
            reject(new Error('Failed to create thumbnail'))
          }
        },
        'image/jpeg',
        0.7
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

// Generate video thumbnail
const generateVideoThumbnail = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2)
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 200

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)

      canvas.toBlob(
        (thumbnailBlob) => {
          if (thumbnailBlob) {
            resolve(URL.createObjectURL(thumbnailBlob))
          } else {
            reject(new Error('Failed to create video thumbnail'))
          }
        },
        'image/jpeg',
        0.7
      )
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video'))
    }

    video.src = url
    video.muted = true
    video.playsInline = true
  })
}

// Extract chat name from ZIP file name
const extractChatName = (fileName: string): string => {
  const nameWithoutExt = fileName.replace(/\.zip$/i, '')
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

  return nameWithoutExt.trim()
}

export default function Home() {
  const [allMessages, setAllMessages] = useState<Message[]>([])
  const [currentUser, setCurrentUser] = useState<string>('')
  const [savedUsername, setSavedUsername] = useState<string>('')
  const [allSenders, setAllSenders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1)
  const [savedChats, setSavedChats] = useState<SavedChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
  const [currentChatName, setCurrentChatName] = useState<string>('')
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [tempUsername, setTempUsername] = useState('')
  const [showMediaPanel, setShowMediaPanel] = useState(false)
  const [mediaFilter, setMediaFilter] = useState<
    'all' | 'images' | 'videos' | 'documents'
  >('all')
  const [imageModal, setImageModal] = useState<{
    src: string
    name: string
  } | null>(null)
  const [containerHeight, setContainerHeight] = useState(600)

  const listRef = useRef<List>(null)
  const blobUrls = useRef<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowHeights = useRef<{ [key: number]: number }>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const mediaObserver = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    loadSavedChats()

    const saved = localStorage.getItem('whatsapp-viewer-username')
    if (saved) {
      setSavedUsername(saved)
    } else {
      setShowUsernameModal(true)
    }

    return () => {
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

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

  const loadSavedChats = async () => {
    try {
      const chats = await getAllChats()
      setSavedChats(chats.sort((a, b) => b.timestamp - a.timestamp))
    } catch (error) {
      console.error('Error loading saved chats:', error)
    }
  }

  const handleSaveUsername = () => {
    if (tempUsername.trim()) {
      localStorage.setItem('whatsapp-viewer-username', tempUsername.trim())
      setSavedUsername(tempUsername.trim())
      setShowUsernameModal(false)
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
      const attachmentMatch = msgText.match(
        /<attached: (.+?)>|<Media omitted>/i
      )
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

      blobUrls.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrls.current = []

      const attachmentMap = new Map<string, Attachment>()
      for (const [filename, zipEntry] of Object.entries(contents.files)) {
        if (filename === '_chat.txt' || zipEntry.dir) continue
        const blob = await zipEntry.async('blob')
        const type = getAttachmentType(filename)
        const blobUrl = URL.createObjectURL(blob)
        blobUrls.current.push(blobUrl)

        let thumbnailUrl: string | undefined

        if (type === 'image' || type === 'sticker') {
          try {
            thumbnailUrl = await generateThumbnail(blob)
            blobUrls.current.push(thumbnailUrl)
          } catch (error) {
            console.error('Error generating image thumbnail:', error)
          }
        } else if (type === 'video') {
          try {
            thumbnailUrl = await generateVideoThumbnail(blob)
            blobUrls.current.push(thumbnailUrl)
          } catch (error) {
            console.error('Error generating video thumbnail:', error)
          }
        }

        attachmentMap.set(filename, {
          name: filename,
          type,
          blobUrl,
          size: blob.size,
          thumbnailUrl,
        })
      }

      const text = await chatFile.async('string')
      const parsed = parseMessages(text, attachmentMap)

      setAllMessages(parsed)
      rowHeights.current = {}

      const senders = [...new Set(parsed.map((m) => m.sender.trim()))]
      setAllSenders(senders)

      if (savedUsername && senders.includes(savedUsername)) {
        setCurrentUser(savedUsername)
      } else {
        setCurrentUser('')
      }

      if (!chatId) {
        const newChatId = Date.now().toString()
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

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.name.endsWith('.zip')) {
      await processZipFile(file, file.name)
    } else {
      alert('Please drop a valid ZIP file')
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
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
          handleBackToHome()
        }
      } catch (error) {
        console.error('Error deleting chat:', error)
        alert('Failed to delete chat')
      }
    }
  }

  const handleBackToHome = () => {
    setAllMessages([])
    setCurrentChatId('')
    setCurrentChatName('')
    setCurrentUser('')
    setAllSenders([])
    setSearchTerm('')
    setSearchResults([])
    setCurrentSearchIndex(-1)
    setShowMediaPanel(false)
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url))
    blobUrls.current = []
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
      (currentSearchIndex - 1 + searchResults.length) %
      searchResults.length
    setCurrentSearchIndex(prevIndex)
    scrollToMessage(searchResults[prevIndex])
  }

  const toggleDarkMode = () => setDarkMode((v) => !v)

  const getRowHeight = (index: number) => {
    return rowHeights.current[index] || 120
  }

  const setRowHeight = useCallback((index: number, size: number) => {
    if (rowHeights.current[index] !== size) {
      rowHeights.current[index] = size
      listRef.current?.resetAfterIndex(index)
    }
  }, [])

  const getMediaMessages = () => {
    return allMessages.filter((msg) => msg.attachment)
  }

  const getFilteredMedia = () => {
    const mediaMessages = getMediaMessages()
    if (mediaFilter === 'all') return mediaMessages
    if (mediaFilter === 'images') {
      return mediaMessages.filter(
        (msg) =>
          msg.attachment?.type === 'image' ||
          msg.attachment?.type === 'sticker'
      )
    }
    if (mediaFilter === 'videos') {
      return mediaMessages.filter((msg) => msg.attachment?.type === 'video')
    }
    if (mediaFilter === 'documents') {
      return mediaMessages.filter(
        (msg) =>
          msg.attachment?.type === 'document' ||
          msg.attachment?.type === 'audio'
      )
    }
    return mediaMessages
  }

  const handleImageClick = (src: string, name: string) => {
    setImageModal({ src, name })
  }

  const handleDocumentDownload = (attachment: Attachment) => {
    const link = document.createElement('a')
    link.href = attachment.blobUrl
    link.download = attachment.name
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && imageModal) {
        setImageModal(null)
      }
    }

    if (imageModal) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [imageModal])

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
          setRowHeight(index, height + 16)
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
    [
      allMessages,
      currentUser,
      searchResults,
      currentSearchIndex,
      setRowHeight,
    ]
  )

  // Lazy loading component for media items
  const LazyMediaItem = ({
    msg,
    index,
  }: {
    msg: Message
    index: number
  }) => {
    const [isVisible, setIsVisible] = useState(false)
    const itemRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (!itemRef.current) return

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setIsVisible(true)
              observer.disconnect()
            }
          })
        },
        {
          rootMargin: '200px',
          threshold: 0.01,
        }
      )

      observer.observe(itemRef.current)
      return () => observer.disconnect()
    }, [])

    return (
      <div ref={itemRef} className="media-item">
        {isVisible ? (
          <>
            {msg.attachment?.type === 'image' ||
            msg.attachment?.type === 'sticker' ? (
              <div
                className="media-image-container"
                onClick={() =>
                  handleImageClick(
                    msg.attachment!.blobUrl,
                    msg.attachment!.name
                  )
                }
              >
                <img
                  src={msg.attachment.thumbnailUrl || msg.attachment.blobUrl}
                  alt={msg.attachment.name}
                  loading="lazy"
                  className="media-thumbnail"
                />
                <div className="image-overlay">
                  <div className="zoom-icon">🔍</div>
                </div>
              </div>
            ) : msg.attachment?.type === 'video' ? (
              <div className="media-video-container">
                <div
                  className="video-thumbnail"
                  style={{
                    backgroundImage: msg.attachment.thumbnailUrl
                      ? `url(${msg.attachment.thumbnailUrl})`
                      : 'none',
                  }}
                >
                  <div className="play-icon">▶</div>
                </div>
                <video
                  src={msg.attachment.blobUrl}
                  controls
                  className="media-video"
                  preload="none"
                />
              </div>
            ) : (
              <div
                className="media-doc"
                onClick={() =>
                  msg.attachment && handleDocumentDownload(msg.attachment)
                }
              >
                <div className="doc-icon">📄</div>
                <div className="doc-name">{msg.attachment?.name}</div>
                <div className="doc-download-btn">Click to Download</div>
              </div>
            )}
            <div className="media-info">
              <span className="media-sender">{msg.sender}</span>
              <span className="media-date">{msg.date}</span>
            </div>
          </>
        ) : (
          <div className="media-placeholder">Loading...</div>
        )}
      </div>
    )
  }

  const isEmptyState = allMessages.length === 0 && !loading

  return (
    <div className={`app-wrapper ${darkMode ? 'dark-mode' : ''}`}>
      {showUsernameModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Welcome to WhatsApp Chat Viewer</h2>
            <p>Please enter your name to personalize your experience:</p>
            <input
              type="text"
              placeholder="Enter your name"
              value={tempUsername}
              onChange={(e) => setTempUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveUsername()}
              className="username-input"
              autoFocus
            />
            <button
              onClick={handleSaveUsername}
              className="save-username-btn"
            >
              Continue
            </button>
            <button
              onClick={() => setShowUsernameModal(false)}
              className="skip-btn"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

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
              <div className="empty-icon">
                <Image
                  src="/eepy.jpg"
                  alt="No chats"
                  width={120}
                  height={120}
                  priority
                />
              </div>
              <p className="empty-title">No saved chats yet</p>
              <p className="empty-subtitle">
                Upload a WhatsApp export to get started
              </p>
            </div>
          ) : (
            <div className="chat-list">
              {savedChats.map((chat) => (
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
                      {chat.messageCount} messages •{' '}
                      {chat.participants.length}{' '}
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
              <Image
              src="/eepy.jpg"
              alt="WhatsApp Chat Viewer"
              width={200}
              height={200}
              style={{ borderRadius: '50%' }}
              priority
              />
              <h1>WhatsApp Chat Viewer</h1>
              <p>Import and view your exported WhatsApp chats</p>
            </div>

            <label
              className="dropzone"
              htmlFor="file-upload"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFile}
                disabled={loading}
                style={{ display: 'none' }}
              />
              <div className="upload-icon">
                <Image
                  src="/white.jpg"
                  alt="Upload"
                  width={80}
                  height={80}
                  priority
                />
              </div>
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
                <button onClick={handleBackToHome} className="back-btn">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <h2>{currentChatName || 'Chat Messages'}</h2>
              </div>
              <div className="header-controls">
                <button
                  onClick={() => setShowMediaPanel(!showMediaPanel)}
                  className="media-btn"
                  title="View media"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
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
                      <button
                        onClick={prevSearchResult}
                        className="nav-button"
                      >
                        ←
                      </button>
                      <button
                        onClick={nextSearchResult}
                        className="nav-button"
                      >
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
                    {allSenders.map((sender) => (
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

            <div className="chat-container">
              {!showMediaPanel ? (
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
              ) : (
                <div className="media-panel">
                  <div className="media-header">
                    <h3>Media, Links and Docs</h3>
                    <div className="media-filters">
                      <button
                        className={mediaFilter === 'all' ? 'active' : ''}
                        onClick={() => setMediaFilter('all')}
                      >
                        All ({getMediaMessages().length})
                      </button>
                      <button
                        className={mediaFilter === 'images' ? 'active' : ''}
                        onClick={() => setMediaFilter('images')}
                      >
                        Images (
                        {
                          getMediaMessages().filter(
                            (m) =>
                              m.attachment?.type === 'image' ||
                              m.attachment?.type === 'sticker'
                          ).length
                        }
                        )
                      </button>
                      <button
                        className={mediaFilter === 'videos' ? 'active' : ''}
                        onClick={() => setMediaFilter('videos')}
                      >
                        Videos (
                        {
                          getMediaMessages().filter(
                            (m) => m.attachment?.type === 'video'
                          ).length
                        }
                        )
                      </button>
                      <button
                        className={
                          mediaFilter === 'documents' ? 'active' : ''
                        }
                        onClick={() => setMediaFilter('documents')}
                      >
                        Docs (
                        {
                          getMediaMessages().filter(
                            (m) =>
                              m.attachment?.type === 'document' ||
                              m.attachment?.type === 'audio'
                          ).length
                        }
                        )
                      </button>
                    </div>
                  </div>
                  <div className="media-grid">
                    {getFilteredMedia().map((msg, idx) => (
                      <LazyMediaItem key={idx} msg={msg} index={idx} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {imageModal && (
        <div
          className="image-modal-overlay"
          onClick={() => setImageModal(null)}
        >
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setImageModal(null)}
            >
              ✕
            </button>
            <img
              src={imageModal.src}
              alt={imageModal.name}
              className="modal-image"
            />
            <div className="modal-info">
              <span className="modal-filename">{imageModal.name}</span>
              <button
                className="modal-download"
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = imageModal.src
                  link.download = imageModal.name
                  link.click()
                }}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}