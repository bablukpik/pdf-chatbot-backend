# PDF Chat RAG Application

A full-stack application that allows users to chat with their PDF documents using RAG (Retrieval-Augmented Generation) and OpenAI.

## Features

- 🤖 AI-powered chat with PDF documents
- 📄 RAG implementation with Qdrant vector database
- 💬 Real-time streaming responses
- 🔒 Rate limiting and input validation
- 📱 Responsive design with modern UI
- 🔄 Conversation history support
- 📋 Copy messages functionality
- 🛑 Request cancellation support

## Tech Stack

### Frontend

- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Lucide React icons

### Backend

- Node.js with Express
- LangChain for RAG
- OpenAI API
- Qdrant Vector Database
- Rate limiting with express-rate-limit

## Setup Instructions

### Prerequisites

- Node.js 18+ installed
- OpenAI API key
- Qdrant instance (cloud or self-hosted)
- PDF documents uploaded to Qdrant

### Frontend Setup

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Create `.env.local` file:
   \`\`\`env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   \`\`\`

3. Run the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

### Backend Setup

1. Navigate to backend directory:
   \`\`\`bash
   cd backend
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Create `.env` file:
   \`\`\`env
   PORT=3001
   FRONTEND_URL=http://localhost:3000
   OPENAI_API_KEY=your_openai_api_key_here
   QDRANT_URL=your_qdrant_url_here
   QDRANT_COLLECTION_NAME=your_collection_name_here
   \`\`\`

4. Run the backend server:
   \`\`\`bash
   npm run dev
   \`\`\`

## Environment Variables

### Frontend (.env.local)

- `NEXT_PUBLIC_API_URL`: Backend API URL

### Backend (.env)

- `PORT`: Server port (default: 3001)
- `FRONTEND_URL`: Frontend URL for CORS
- `OPENAI_API_KEY`: Your OpenAI API key
- `QDRANT_URL`: Qdrant database URL
- `QDRANT_COLLECTION_NAME`: Qdrant collection name

## API Endpoints

### POST /chat

Chat with PDF documents using RAG.

**Request Body:**
\`\`\`json
{
"message": "Your question here",
"conversationHistory": [
{
"role": "user",
"content": "Previous message"
}
]
}
\`\`\`

**Response:** Server-Sent Events stream with:

- `type: "context"` - Document count information
- `type: "docs"` - Retrieved documents
- `type: "stream"` - Streaming response content
- `type: "done"` - Completion signal
- `type: "error"` - Error information

### GET /health

Health check endpoint.

## Usage

1. Start both frontend and backend servers
2. Open http://localhost:3000 in your browser
3. Type your question about the PDF documents
4. Get AI-powered responses with source citations

## Features in Detail

### RAG Implementation

- Uses OpenAI embeddings for document retrieval
- Qdrant vector database for similarity search
- Context-aware responses with source citations

### Security Features

- Rate limiting (50 requests per 15 minutes)
- Input validation and sanitization
- CORS protection
- Request timeout handling

### User Experience

- Real-time streaming responses
- Conversation history
- Copy message functionality
- Request cancellation
- Error handling with user-friendly messages
- Responsive design

## Deployment

### Frontend (Vercel)

1. Push code to GitHub
2. Connect repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Backend (Railway/Heroku)

1. Push backend code to GitHub
2. Connect to your hosting platform
3. Add environment variables
4. Deploy

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details
