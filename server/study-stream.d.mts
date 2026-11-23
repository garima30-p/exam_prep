export function readStudyEvents(
 stream:ReadableStream<Uint8Array>,
 receive:(event:string,data:string)=>void|false,
 signal?:AbortSignal
):Promise<void>;
