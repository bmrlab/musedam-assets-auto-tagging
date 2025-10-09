import { cn } from '@/lib/utils';
import { memo, useMemo, useState } from 'react';
import Image from "next/image"

enum EAssetPreviewType {
    image = 1,
    video,
    document,
    design,
    audio,
    font,
    url,
    jsDesign,
    jsdUrl,
    virtualScene,
    epub
}

enum ETypes3D {
    obj = 'obj',
    stl = 'stl',
    fbx = 'fbx',
    gltf = 'gltf',
    glb = 'gltf',
    c4d = 'c4d',
    // 媒体服务目前不支持
    '3ds' = '3ds',
    ply = 'ply',
}

const mainFileExtensionsSet = new Set(Object.keys(ETypes3D));

function is3dFileExtension(extension: string) {
    return mainFileExtensionsSet.has(extension);
}

const canPreviewTypes: Record<EAssetPreviewType, readonly string[]> = {
    // TODO: 完善文件类型
    [EAssetPreviewType.image]: [
        'jpeg',
        'svg',
        'jpg',
        'png',
        'gif',
        'tif',
        'tiff',
        'bmp',
        'heic',
        'pic',
        'webp',
        'hdr',
        'exr',
        'avif',
        'insp'
    ],
    [EAssetPreviewType.video]: ['mp4', 'flv', 'webm', 'mov', 'qt', 'm4v', 'avi', 'mkv', 'mgb', 'rmvb', 'rm', 'mpg', 'ts', 'insv'],
    [EAssetPreviewType.audio]: ['mp3', 'm4a', 'wav', 'mpga', 'wma', 'oga', 'ogg', 'flac', 'aac'],
    [EAssetPreviewType.font]: ['ttf', 'ttc', 'otf', 'woff'],
    [EAssetPreviewType.url]: ['url'],
    [EAssetPreviewType.document]: [
        'html',
        'pdf',
        'docx',
        'doc',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
        'csv',
        'key',
        'et',
        'xlt',
        'xlsm',
        'xltm',
        'xltx',
        'dot',
        'doxm',
        'cdr',
        'eps',
        'ett',
        'numbers',
        'wpt',
        'pages',
        'wps',
        'dotx',
        'docm',
        'dotm',
        'rtf',
        'pptm',
        'ppsx',
        'ppsm',
        'pps',
        'potx',
        'potm',
        'dpt',
        'dps',
        'txt',
        'latex',
        'markdown',
        'md',
        'tex'
    ],
    [EAssetPreviewType.jsDesign]: ['jsd', 'sketch', 'xd', 'fig', 'figma'],
    [EAssetPreviewType.jsdUrl]: [],
    [EAssetPreviewType.design]: ['ai', 'psd', 'psb', 'exr', 'hdr', 'cdr', 'eps', 'fig'],
    [EAssetPreviewType.virtualScene]: Object.keys(ETypes3D),
    [EAssetPreviewType.epub]: ['epub']
};

//TODO 把canPreviewTypes 转成Map
const extToTypeMap = new Map<string, number>();

// 初始化 extToTypeMap
Object.entries(canPreviewTypes).forEach(([typeKey, extensions]) => {
    const type = parseInt(typeKey) as EAssetPreviewType;
    extensions.forEach(ext => {
        extToTypeMap.set(ext.toLowerCase(), type);
    });
});

export function getAssetPreviewType(options: {
    extension?: string | null;
    type?: string | null;
}): EAssetPreviewType | undefined {
    if (options.extension?.toLocaleLowerCase() === 'epub') {
        return EAssetPreviewType.epub
    }
    return is3dPackageAsset(options) || is3dFileExtension(options.extension || '')
        ? EAssetPreviewType.virtualScene
        : extToTypeMap.get(options.extension?.toLowerCase() || '');
}

function getFileType(ext = ''): EAssetPreviewType | undefined {

    return extToTypeMap.get(ext?.toLocaleLowerCase());
}

function isVideo(ext: string) {
    return getFileType(ext) === EAssetPreviewType.video;
}

function isAudio(ext: string) {
    return getFileType(ext) === EAssetPreviewType.audio;
}


function is3dPackageAsset(asset: object) {
    const a = asset as any;
    return a.type === 'triD' || a.type === 'PROJECT_3D';
}

export const AssetThumbnail = memo(
    ({ asset, maxWidth = 24, maxHeight = 24, className }: { asset: { thumbnailUrl?: string, extension?: string }; maxWidth?: number; maxHeight?: number, className?: string }) => {
        const [isError, setIsError] = useState(false);
        const renderAssetThumbnail = useMemo(() => {
            if (!asset.thumbnailUrl) return null;
            return (
                <Image
                    src={asset.thumbnailUrl}
                    alt=""
                    width={maxWidth}
                    height={maxHeight}
                    className={cn("rounded object-cover", className)}
                    onError={() => {
                        setIsError(true);
                    }}
                />
            );
        }, [asset, maxWidth, maxHeight, className]);




        const renderAssetThumbnailIcon = useMemo(() => {
            // 3d
            if (is3dPackageAsset(asset)) {
                return <Image src="/asset-thumbnail/3d.svg" alt="3d" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // ai
            if (asset.extension === 'ai') {
                return <Image src="/asset-thumbnail/ai.svg" alt="ai" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // csv
            if (asset.extension === 'csv') {
                return <Image src="/asset-thumbnail/csv.svg" alt="csv" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // docx
            if (asset.extension === 'doc' || asset.extension === 'docx') {
                return <Image src="/asset-thumbnail/docx.svg" alt="docx" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // eaglepack
            if (asset.extension === 'eaglepack') {
                return <Image src="/asset-thumbnail/eaglepack.svg" alt="eaglepack" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // figma
            if (asset.extension === 'fig' || asset.extension === 'figma') {
                return <Image src="/asset-thumbnail/figma.svg" alt="figma" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // font
            if (getFileType(asset.extension) === EAssetPreviewType.font) {
                return <Image src="/asset-thumbnail/font.svg" alt="font" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // js
            if (asset.extension === 'jsd') {
                return <Image src="/asset-thumbnail/js.svg" alt="js" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // model
            if (
                asset.extension === 'onnx' ||
                asset.extension === 'pt' ||
                asset.extension === 'pth' ||
                asset.extension === 'ckpt'
            ) {
                return <Image src="/asset-thumbnail/model.svg" alt="model" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // music
            if (asset.extension && isAudio(asset.extension)) {
                return <Image src="/asset-thumbnail/music.svg" alt="music" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // other-txt
            if (
                asset.extension === 'txt' ||
                asset.extension === 'pages' ||
                asset.extension === 'key' ||
                asset.extension === 'wps'
            ) {
                return <Image src="/asset-thumbnail/other-txt.svg" alt="other-txt" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // pdf
            if (asset.extension === 'pdf') {
                return <Image src="/asset-thumbnail/pdf.svg" alt="pdf" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // ppt
            if (asset.extension === 'ppt') {
                return <Image src="/asset-thumbnail/ppt.svg" alt="ppt" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // psd
            if (asset.extension === 'psd') {
                return <Image src="/asset-thumbnail/psd.svg" alt="psd" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // sketch
            if (asset.extension === 'sketch') {
                return <Image src="/asset-thumbnail/sketch.svg" alt="sketch" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // xd
            if (asset.extension === 'xd') {
                return <Image src="/asset-thumbnail/xd.svg" alt="xd" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // xls xlsx xlsm
            if (asset.extension === 'xls' || asset.extension === 'xlsx' || asset.extension === 'xlsm') {
                return <Image src="/asset-thumbnail/xls.svg" alt="xls" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            const zipList = ['zip', 'rar', 'gzip', '7z', 'tar', 'bz2', 'xz'];
            // zip
            if (zipList.some((type) => type === asset.extension)) {
                return <Image src="/asset-thumbnail/zip.svg" alt="zip" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // image
            if (getFileType(asset.extension) === EAssetPreviewType.image) {
                return <Image src="/asset-thumbnail/image.svg" alt="image" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // video
            if (asset.extension && isVideo(asset.extension)) {
                return <Image src="/asset-thumbnail/video.svg" alt="video" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            // other
            if (!!getFileType(asset.extension)) {
                return <Image src="/asset-thumbnail/other.svg" alt="other" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
            }

            return <Image src="/asset-thumbnail/unknown.svg" alt="unknown" width={maxWidth} height={maxHeight} className={cn('object-contain', className)} />;
        }, [asset.extension, maxWidth, maxHeight, className]);

        return (
            <div className="flex justify-center items-center" style={{ width: maxWidth, height: maxHeight }}>
                {isError ? renderAssetThumbnailIcon : !!asset.thumbnailUrl ? renderAssetThumbnail : renderAssetThumbnailIcon}
            </div>
        );
    }
);

AssetThumbnail.displayName = 'AssetThumbnail';
