import type { Turn } from '../../contracts/src/index';
export function scoreFromDimensions(dimensions:NonNullable<Turn['assessment']['dimensions']>){return Math.round((dimensions.relevance+dimensions.depth+dimensions.clarity+dimensions.evidence)/4);}
