'use client';

import Script from 'next/script';
import dynamic from 'next/dynamic';

const Live2DViewer = dynamic(() => import('./Live2DViewer'), { ssr: false });

export default function DisplayPage() {
    return (
        <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)] bg-[#00ff00] relative overflow-hidden">
            <Script
                src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
                strategy="beforeInteractive"
            />
            <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start w-full h-[80vh]">
                <Live2DViewer modelPath="/live2dModel/hiyori_free_jp/runtime/hiyori_free_t08.model3.json" />
            </main>
        </div>
    );
}
