import { Express } from 'express'

import contract from './contract.route.js'

/**
 * @function router
 * @description
 * Registers all API route modules with the provided Express application.
 *
 * This function attaches route handlers to the Express `app` instance.
 * In this case, it maps the `/api/v1/contract` endpoint to the `contract` router,
 * which contains all contract-related API routes and middleware.
 *
 * @param {Express} app - The main Express application instance used to register routes.
 *
 * @example
 * import express from 'express';
 * import router from './routes';
 *
 * const app = express();
 * router(app); // Registers all route modules under /api/v1/contract
 */
const router = function (app: Express) {
    app.use('/api/v1/contract', contract)
}

export default router
