FROM node:20-alpine

WORKDIR /app

# Install dependencies for FFmpeg and Node.js
RUN apk add --no-cache \
    ffmpeg \
    bash \
    python3 \
    make \
    g++ \
    font-dejavu \
    ttf-freefont

COPY package*.json ./

RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Create directory for media assets
RUN mkdir -p public/media

EXPOSE 3000

CMD ["sh", "-c", "npx prisma generate && npm run dev"]
