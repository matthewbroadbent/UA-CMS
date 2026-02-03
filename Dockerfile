FROM node:18-alpine

WORKDIR /app

# Install dependencies for FFmpeg and Node.js
RUN apk add --no-cache \
    ffmpeg \
    bash \
    python3 \
    make \
    g++

COPY package*.json ./

RUN npm install

COPY . .

# Create directory for media assets
RUN mkdir -p public/media

EXPOSE 3000

CMD ["npm", "run", "dev"]
