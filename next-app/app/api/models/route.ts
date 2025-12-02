import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// モデル情報の型定義
interface ModelInfo {
    label: string;
    path: string;
}

// ディレクトリを再帰的に探索して .model3.json ファイルを探す関数
function findModelFiles(dir: string, baseDir: string, modelList: ModelInfo[]) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            findModelFiles(fullPath, baseDir, modelList);
        } else if (file.endsWith('.model3.json')) {
            // Webアクセス用のパスに変換 (/public を除去)
            const relativePath = fullPath.replace(baseDir, '');
            const webPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

            // ラベルは親ディレクトリ名を使用（例: hiyori_free_t08）
            // パス構造: .../modelName/runtime/file.model3.json の場合が多い
            // 親ディレクトリ名を取得
            const parentDir = path.basename(path.dirname(fullPath));
            // さらにその親ディレクトリ名も取得して、より分かりやすい名前にすることも検討できるが、
            // 一旦はファイル名から拡張子を除いたものや親ディレクトリ名を使う

            // ここでは親フォルダ名を使用する
            // 例: /live2dModel/hiyori_free_jp/runtime/hiyori_free_t08.model3.json -> hiyori_free_t08
            const label = parentDir === 'runtime'
                ? path.basename(path.dirname(path.dirname(fullPath))) // runtimeの親
                : parentDir;

            modelList.push({
                label: label,
                path: webPath,
            });
        }
    }
}

export async function GET() {
    try {
        const publicDir = path.join(process.cwd(), 'public');
        const modelsDir = path.join(publicDir, 'live2dModel');
        const modelList: ModelInfo[] = [];

        if (fs.existsSync(modelsDir)) {
            findModelFiles(modelsDir, publicDir, modelList);
        }

        return NextResponse.json({ models: modelList });
    } catch (error) {
        console.error('Error finding model files:', error);
        return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
    }
}
