# Dev server for the local test environment (see README). The Supabase stack it
# talks to runs separately, from `npx supabase start`.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host so the dev server accepts connections from outside the container.
CMD ["npm", "run", "dev:docker", "--", "--host", "0.0.0.0"]
