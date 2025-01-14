# Use an official Node.js runtime as the base image
FROM node:20-alpine

# Install OpenSSL 3.x and related dependencies
RUN apk add --no-cache \
    openssl \
    tzdata
    
ENV TZ=Asia/Tokyo

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

RUN npm config set legacy-peer-deps true
# Install dependencies
RUN npm ci

# Copy the entire app source
COPY . .

# RUN npx prisma generate
RUN npm run build
# Expose the application port
EXPOSE 3000

# Set the default command for the container
CMD ["npm", "run", "start"]
