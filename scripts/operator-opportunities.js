// CLI entrance to the same persisted opportunity service used by the HTTP API.
import { createOpportunityService } from '../server/opportunity-service.js';

const command = process.argv[2];
if (!['evaluate', 'fund', 'settle', 'verify'].includes(command)) {
  throw Error('Usage: node --env-file=.env scripts/operator-opportunities.js evaluate|fund|settle|verify');
}
await createOpportunityService()[command]();
