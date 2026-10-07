import 'dotenv/config';
import logger from '../../backend/src/utils/logger.js';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3003;

createApp().listen(PORT, () => {
  logger.info(`MCP server listening on port ${PORT}`);
});
