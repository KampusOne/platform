import {z} from '@kampusone/contracts';

const coordinate=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
/** A place ID resolves an approved entrance; a map pin routes to the sourced path nearby. */
export const campusRouteInput=z.object({
  campusId:z.string().uuid(),
  origin:coordinate,
  originPlaceId:z.string().uuid().optional(),
  destinationId:z.string().uuid().optional(),
  destination:coordinate.optional(),
  accessible:z.boolean().default(false),
}).strict().refine(data=>Boolean(data.destinationId)!==Boolean(data.destination),{
  message:'Choose a campus place or a destination pin.',
  path:['destination'],
});
