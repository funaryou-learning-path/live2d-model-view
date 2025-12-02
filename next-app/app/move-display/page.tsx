'use client';

import Script from 'next/script';
import dynamic from 'next/dynamic';

const Live2DCameraViewer = dynamic(() => import('./Live2DCameraViewer'), { ssr: false });

export default function MoveDisplayPage() {
    return (
        <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)] bg-gradient-to-br from-blue-50 to-purple-50 relative overflow-hidden">
            <Script
                src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
                strategy="beforeInteractive"
            />
            <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start w-full h-[90vh] bg-[#00ff00]">
                <h1 className="text-3xl font-bold text-gray-800 mb-4">Live2D カメラ連動</h1>
                <Live2DCameraViewer modelPath="/live2dModel/hiyori_free_jp/runtime/hiyori_free_t08.model3.json" />
            </main>
        </div>
    );
}

