// The fixture runs outside Next; preserve the image markup without Next's image runtime.
import type { ImgHTMLAttributes } from 'react';
export default function Image(props:ImgHTMLAttributes<HTMLImageElement>) {return <img {...props} />;}
