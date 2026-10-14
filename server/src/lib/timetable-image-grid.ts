import {decode as jpeg} from 'jpeg-js';
import {decode as decodePng,encode as encodePng} from 'fast-png';
import {createTimetablePixels} from '../../../packages/contracts/src/timetable-pixels';
export type {TimetableImageRow,TimetableLayoutImage} from '../../../packages/contracts/src/timetable-pixels';
const pixels=createTimetablePixels({decodeJpeg:bytes=>jpeg(bytes,{useTArray:true,maxResolutionInMP:4,maxMemoryUsageInMB:48,tolerantDecoding:false}),decodePng,encodePng});
export const {timetableLayoutImage,timetableImageRows}=pixels;
