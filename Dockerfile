FROM node:20-alpine

WORKDIR /app

# Install system FFmpeg (with font support for ASS subtitle rendering) and build tools
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

# Build the Next.js app for production (also runs prisma generate)
RUN npm run build

# Create directory for media assets
RUN mkdir -p public/media

EXPOSE 3000

CMD ["npm", "start"]
