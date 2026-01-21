import { Router } from 'express'
import { mint, batchMint, update, burn, contract } from '../controllers/contract.controller.js'

const router: Router = Router()

router.post('/mint', mint)
router.post('/batch-mint', batchMint)
router.post('/update', update)
router.post('/burn', burn)
router.get('/', contract)

export default router
