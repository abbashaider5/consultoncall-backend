# ConsultOnCall - Backend API

Production-ready backend API for ConsultOnCall expert consultation platform.

## 🚀 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose)
- **Authentication**: JWT + Google OAuth + LinkedIn OAuth
- **Real-time**: Socket.IO
- **Payment**: Razorpay
- **Deployment**: Vercel Serverless

## 📋 Features

### Authentication & Authorization
- ✅ JWT-based authentication
- ✅ Google OAuth 2.0 integration
- ✅ LinkedIn OAuth integration
- ✅ Role-based access control (User, Expert, Admin)
- ✅ Blocked/suspended user prevention
- ✅ Password hashing with bcrypt

### Expert System
- ✅ Expert profile creation
- ✅ Admin approval workflow
- ✅ Expert verification badges
- ✅ Availability status (Online/Busy/Offline)
- ✅ Per-minute rate configuration
- ✅ Categories and skills management

### Call Management
- ✅ Real-time call initiation
- ✅ Call lifecycle (Initiated → Ongoing → Completed)
- ✅ Automatic billing per minute
- ✅ Low balance auto-disconnect
- ✅ Call history tracking
- ✅ Expert busy state management

### Wallet & Billing
- ✅ ₹10 signup bonus
- ✅ Minimum ₹100 top-up
- ✅ Per-minute billing (rounded up)
- ✅ 90% expert payout, 10% platform fee
- ✅ Transaction history
- ✅ Razorpay integration

### Admin Panel
- ✅ User management (Block/Unblock)
- ✅ Expert approval/rejection
- ✅ Expert verification
- ✅ Platform statistics
- ✅ Revenue tracking

## 🔧 Installation

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Google Cloud Console account (for OAuth)

### Local Setup

1. **Clone repository**
```bash
git clone https://github.com/abbashaider5/consultoncall-backend.git
cd consultoncall-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Create .env file**
```bash
cp .env.example .env
```

4. **Configure environment variables**
```env
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_jwt_secret_minimum_32_chars
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NODE_ENV=development
PORT=5000
```

5. **Run development server**
```bash
npm run dev
```

Server runs at: http://localhost:5000

## 📡 API Endpoints

### Health Check
```
GET /api/health
```

### Authentication
```
POST   /api/auth/register
POST   /api/auth/register-expert
POST   /api/auth/login
GET    /api/auth/me
GET    /api/auth/google
GET    /api/auth/google/callback
GET    /api/auth/linkedin
GET    /api/auth/linkedin/callback
```

### Users
```
GET    /api/users/profile
PUT    /api/users/profile
POST   /api/users/upload-avatar
POST   /api/users/buy-tokens
POST   /api/users/create-order
POST   /api/users/verify-payment
GET    /api/users/tokens
GET    /api/users/transactions
```

### Experts
```
GET    /api/experts
GET    /api/experts/online
GET    /api/experts/:id
GET    /api/experts/my-profile
PUT    /api/experts/profile
POST   /api/experts/claim-tokens
```

### Admin - Users
```
GET    /api/users/admin/all
GET    /api/users/admin/statistics
PUT    /api/users/admin/:id/status
DELETE /api/users/admin/:id
```

### Admin - Experts
```
GET    /api/experts/admin/pending
PUT    /api/experts/admin/:id/approve
PUT    /api/experts/admin/:id/reject
PUT    /api/experts/admin/:id/verify
DELETE /api/experts/admin/:id
```

### Calls
```
POST   /api/calls/initiate
PUT    /api/calls/start/:callId
PUT    /api/calls/end/:callId
GET    /api/calls/check-balance/:callId
GET    /api/calls/history
```

### Categories
```
GET    /api/categories
POST   /api/categories (admin only)
PUT    /api/categories/:id (admin only)
DELETE /api/categories/:id (admin only)
```

## 🔌 Socket.IO Events

### Client → Server
- `user-online` - User comes online
- `expert-online` - Expert comes online
- `expert-offline` - Expert goes offline
- `initiate-call` - Initiate call to expert
- `accept-call` - Expert accepts call
- `reject-call` - Expert rejects call
- `end-call` - End ongoing call
- `check-call-balance` - Check balance during call
- `offer` - WebRTC offer
- `answer` - WebRTC answer
- `ice-candidate` - WebRTC ICE candidate

### Server → Client
- `expert-status-change` - Expert online/offline status
- `incoming-call` - Incoming call notification
- `call-accepted` - Call accepted by expert
- `call-rejected` - Call rejected by expert
- `call-started` - Call started successfully
- `call-ended` - Call ended
- `call-ended-low-balance` - Call ended due to low balance
- `insufficient-balance` - Balance too low to continue
- `call-error` - Call error occurred

## 🔒 Security

- JWT tokens with 7-day expiry
- Password hashing with bcrypt (10 rounds)
- CORS restricted to frontend domain
- Environment variables for secrets
- Blocked/suspended user prevention
- MongoDB injection prevention (Mongoose sanitization)

## 🌐 Production Deployment

### Vercel Setup

1. **Import GitHub repository**
2. **Framework**: Other
3. **Build Command**: (leave empty)
4. **Output Directory**: (leave empty)
5. **Install Command**: `npm install`

### Environment Variables

Add all variables from `.env.example` in Vercel Dashboard.

### Custom Domain

Add custom domain: `api.abbaslogic.com`

## 📊 Database Schema

### User
- name, email, password (hashed)
- role (user/expert/admin)
- tokens (wallet balance)
- status (active/blocked/suspended)
- OAuth provider info

### Expert
- user reference
- title, bio, categories
- tokensPerMinute (rate)
- isApproved, isVerified
- isOnline, isBusy, isAvailable
- stats (calls, minutes, earnings)

### Call
- caller, expert references
- status, duration
- tokensPerMinute, tokensSpent
- startTime, endTime

### Transaction
- user reference
- type (credit/debit)
- tokens, description
- tokensBefore, tokensAfter

## 🛠️ Development

### Run in development mode
```bash
npm run dev
```

### Run in production mode
```bash
npm start
```

### Seed database (optional)
```bash
node seed.js
```

## 📝 License

MIT

## 👨‍💻 Developer

Abbas Haider
- GitHub: [@abbashaider5](https://github.com/abbashaider5)
