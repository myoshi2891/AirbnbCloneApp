# Use an official Node.js runtime as the base image
FROM node:20-alpine

# Install OpenSSL 3.x and related dependencies
# RUN apk add --no-cache openssl

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire app source
COPY . .

# Expose the application port
EXPOSE 3000

# Set the default command for the container
CMD ["npm", "start"]
