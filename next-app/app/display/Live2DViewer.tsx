'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
// Cubism 4専用のインポートパスを使用
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// PIXIをwindowオブジェクトに露出させる
// pixi-live2d-displayが内部でPIXI.Ticker.sharedを参照する可能性があるため、
// グローバルに設定する必要がある
if (typeof window !== 'undefined') {
    (window as any).PIXI = PIXI;
    // PIXI.Ticker.sharedが存在することを確認
    if (PIXI.Ticker && PIXI.Ticker.shared) {
        console.log('PIXI.Ticker.shared is available globally');
    } else {
        console.warn('PIXI.Ticker.shared is not available - this may cause issues with pixi-live2d-display');
    }
}

interface Live2DViewerProps {
    modelPath: string;
}

/**
 * Live2Dモデルを表示するReactコンポーネント
 * @param {Live2DViewerProps} props - モデルのパスを含むプロパティ
 */
export default function Live2DViewer({ modelPath }: Live2DViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);

    useEffect(() => {
        const currentCanvas = canvasRef.current;
        // 既に初期化済みなら何もしない（Strict Mode対策）
        if (!currentCanvas || appRef.current) return;

        // Cubism Coreがロードされているか確認
        // Live2DModelのインポートが成功していれば、通常はロード済みのはずですが、念のためチェックを継続
        if (!(window as any).Live2DCubismCore) {
            console.warn('Live2DCubismCore is not loaded yet.');
            // エラー表示をより親切にする
            setError('Live2D Core Library (Live2DCubismCore) not loaded. Check script loading order.');
            return;
        }

        const init = async () => {
            try {
                // 親要素のサイズが確定するまで待機（タイムアウト付き）
                const waitForParentSize = (): Promise<{ width: number; height: number }> => {
                    return new Promise((resolve) => {
                        let attempts = 0;
                        const maxAttempts = 100; // 最大100フレーム（約1.6秒）待機
                        
                        const checkSize = () => {
                            attempts++;
                            const parent = currentCanvas.parentElement;
                            if (parent) {
                                const width = parent.clientWidth;
                                const height = parent.clientHeight;
                                if (width > 0 && height > 0) {
                                    resolve({ width, height });
                                    return;
                                }
                            }
                            
                            // タイムアウトした場合はデフォルト値を使用
                            if (attempts >= maxAttempts) {
                                console.warn('Parent size not available, using default values');
                                resolve({ width: 800, height: 600 });
                                return;
                            }
                            
                            // サイズが確定していない場合は、次のフレームで再試行
                            requestAnimationFrame(checkSize);
                        };
                        checkSize();
                    });
                };

                const { width: parentWidth, height: parentHeight } = await waitForParentSize();
                const width = Math.max(parentWidth, 1); // 0を防ぐ
                const height = Math.max(parentHeight, 1); // 0を防ぐ

                // 1. PIXI Applicationの作成（v5のAPI）
                // 参考記事: https://zenn.dev/seya/articles/60cb040edfd40e
                // PIXI.js v5では、backgroundAlphaの代わりにtransparentを使用
                const app = new PIXI.Application({
                    view: currentCanvas,
                    transparent: true, // PIXI.js v5ではbackgroundAlphaの代わりにtransparentを使用
                    width: width,
                    height: height,
                    resolution: window.devicePixelRatio || 1,
                    autoDensity: true,
                });
                appRef.current = app;

                // Applicationの初期化を待つ（次のフレームまで待機）
                // PIXI.js v6では、Applicationの作成後すぐにTickerが開始される
                await new Promise(resolve => {
                    if (app.ticker.started) {
                        resolve(undefined);
                    } else {
                        // Tickerが開始されるまで待機
                        const checkTicker = () => {
                            if (app.ticker.started) {
                                resolve(undefined);
                            } else {
                                requestAnimationFrame(checkTicker);
                            }
                        };
                        checkTicker();
                    }
                });

                // Tickerの登録を確認（Application初期化後）
                // pixi-live2d-displayがTickerにアクセスする前に確実に登録
                // PIXI.js v6では、PIXI.Ticker.sharedは読み取り専用のため、
                // registerTickerメソッドを使用してTickerを登録する
                try {
                    // app.tickerが確実に初期化されていることを確認
                    if (!app.ticker) {
                        console.error('Ticker is not properly initialized');
                        throw new Error('Ticker initialization failed');
                    }

                    // Tickerのaddメソッドが存在することを確認
                    if (typeof app.ticker.add !== 'function') {
                        console.error('Ticker.add is not a function', app.ticker);
                        throw new Error('Ticker.add is not available');
                    }

                    // PIXI.Ticker.sharedの状態を確認
                    const hasSharedTicker = !!(PIXI.Ticker && PIXI.Ticker.shared);
                    console.log('Ticker status:', {
                        hasSharedTicker: hasSharedTicker,
                        appTickerType: app.ticker.constructor.name,
                        appTickerHasAdd: typeof app.ticker.add === 'function',
                        sharedTickerType: hasSharedTicker ? PIXI.Ticker.shared.constructor.name : 'none',
                    });

                    // registerTickerを呼び出す
                    // pixi-live2d-displayはregisterTickerを通じてTickerを登録する
                    // 常にapp.tickerを使用（PIXI.Ticker.sharedが存在しない場合に備える）
                    const tickerToRegister = app.ticker;
                    console.log('Registering ticker:', {
                        tickerType: tickerToRegister.constructor.name,
                        hasAdd: typeof tickerToRegister.add === 'function',
                        tickerObject: tickerToRegister,
                    });
                    
                    // registerTickerを呼び出す
                    // 参考記事によると、PIXI.Tickerクラス自体を渡す必要がある
                    // https://zenn.dev/seya/articles/60cb040edfd40e
                    if (PIXI.Ticker) {
                        Live2DModel.registerTicker(PIXI.Ticker as any);
                        console.log('Ticker registered successfully via registerTicker (PIXI.Ticker class)');
                    } else {
                        console.error('PIXI.Ticker is not available');
                        throw new Error('PIXI.Ticker is not available');
                    }
                    
                    // pixi-live2d-displayが内部で使用するTickerを直接設定する試み
                    // Live2DModelの静的プロパティや内部状態を確認
                    const live2dModelAny = Live2DModel as any;
                    console.log('Live2DModel static properties:', {
                        hasTicker: 'ticker' in live2dModelAny,
                        tickerValue: live2dModelAny.ticker,
                        allKeys: Object.keys(live2dModelAny).slice(0, 20), // 最初の20個のみ表示
                    });
                    
                    // Live2DModelの静的プロパティに直接設定を試みる
                    // pixi-live2d-displayが内部で使用するTickerを確実に設定する
                    live2dModelAny.ticker = tickerToRegister;
                    console.log('Set Live2DModel.ticker directly:', {
                        tickerType: live2dModelAny.ticker?.constructor.name,
                        hasAdd: typeof live2dModelAny.ticker?.add === 'function',
                    });
                    
                    // pixi-live2d-displayが内部で使用する可能性のある他のプロパティも確認
                    // _tickerやtickerInstanceなどの名前で保存されている可能性がある
                    const possibleTickerNames = ['_ticker', 'tickerInstance', 'ticker', 'Ticker'];
                    for (const name of possibleTickerNames) {
                        if (name in live2dModelAny) {
                            live2dModelAny[name] = tickerToRegister;
                            console.log(`Set Live2DModel.${name} directly`);
                        }
                    }
                    
                    // 登録後、pixi-live2d-displayが内部で使用するTickerを確認
                    // pixi-live2d-displayが内部でPIXI.Ticker.sharedを参照している可能性があるため、
                    // それが正しく設定されていることを確認
                    if (PIXI.Ticker && PIXI.Ticker.shared) {
                        console.log('PIXI.Ticker.shared exists:', {
                            type: PIXI.Ticker.shared.constructor.name,
                            hasAdd: typeof PIXI.Ticker.shared.add === 'function',
                        });
                    } else {
                        console.warn('PIXI.Ticker.shared does not exist - pixi-live2d-display may have issues');
                        // PIXI.Ticker.sharedが存在しない場合、pixi-live2d-displayが
                        // 内部でPIXI.Ticker.sharedを参照している可能性があるため、
                        // 警告を出して続行を試みる
                    }
                } catch (e) {
                    console.error("Failed to register ticker:", e);
                    setError('Failed to initialize Ticker for Live2D model.');
                    return;
                }

                // 2. モデルのロード
                // pixi-live2d-displayがTickerにアクセスする前に、
                // Tickerが確実に初期化されていることを確認
                // 少し待機してからロード（Tickerの初期化を確実にする）
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Live2DModel.from()を呼び出す前に、Tickerが確実に設定されていることを再確認
                const finalTicker = (PIXI.Ticker && PIXI.Ticker.shared) || app.ticker;
                if (!finalTicker || typeof finalTicker.add !== 'function') {
                    console.error('Ticker is not properly set before model loading');
                    setError('Ticker is not properly initialized before model loading.');
                    return;
                }
                
                console.log('Loading Live2D model with ticker:', {
                    tickerType: finalTicker.constructor.name,
                    hasAdd: typeof finalTicker.add === 'function',
                });
                
                // Live2DModel.from()を呼び出す前に、pixi-live2d-displayが
                // 内部で使用するTickerを再度確認・設定
                // pixi-live2d-displayが内部でPIXI.Ticker.sharedを参照している可能性があるため、
                // それが確実に設定されていることを確認
                const tickerBeforeLoad = (PIXI.Ticker && PIXI.Ticker.shared) || app.ticker;
                console.log('Ticker before Live2DModel.from():', {
                    hasShared: !!(PIXI.Ticker && PIXI.Ticker.shared),
                    appTickerExists: !!app.ticker,
                    tickerType: tickerBeforeLoad?.constructor.name,
                    tickerHasAdd: typeof tickerBeforeLoad?.add === 'function',
                    // pixi-live2d-displayが内部で使用するTickerを確認
                    windowPIXI: !!(window as any).PIXI,
                    windowPIXITicker: !!(window as any).PIXI?.Ticker,
                    windowPIXITickerShared: !!(window as any).PIXI?.Ticker?.shared,
                });
                
                // Live2DModel.from()を呼び出す
                // 参考記事: https://zenn.dev/seya/articles/60cb040edfd40e
                // pixi-live2d-displayが内部でTickerにアクセスする際に、
                // registerTickerで登録したTickerが使用されることを期待
                let model: Live2DModel;
                try {
                    model = await Live2DModel.from(modelPath);
                    modelRef.current = model;
                    
                    // 参考記事によると、autoUpdateをtrueに設定する必要がある
                    // これにより、モデルの自動更新が有効になる
                    if ('autoUpdate' in model) {
                        (model as any).autoUpdate = true;
                        console.log('Set model.autoUpdate = true');
                    }
                } catch (modelError) {
                    // モデルロード時のエラーを詳細にログ出力
                    console.error('Error during Live2DModel.from():', modelError);
                    // Tickerの状態を再確認
                    const currentTicker = (PIXI.Ticker && PIXI.Ticker.shared) || app.ticker;
                    console.error('Ticker state at error:', {
                        hasShared: !!(PIXI.Ticker && PIXI.Ticker.shared),
                        appTickerExists: !!app.ticker,
                        currentTickerType: currentTicker?.constructor.name,
                        currentTickerHasAdd: typeof currentTicker?.add === 'function',
                        // pixi-live2d-displayが内部で使用するTickerを確認
                        live2dModelTicker: (Live2DModel as any).ticker,
                    });
                    throw modelError;
                }

                // 3. モデルの配置
                model.x = app.screen.width / 2;
                model.y = app.screen.height / 2;
                model.anchor.set(0.5, 0.5);

                // 4. スケール調整
                const scaleFactor = 0.8; // 画面の80%に収める
                const scaleX = (app.screen.width * scaleFactor) / model.width;
                const scaleY = (app.screen.height * scaleFactor) / model.height;
                const scale = Math.min(scaleX, scaleY);
                model.scale.set(scale);

                // 5. Stageに追加
                app.stage.addChild(model as any);

                // 画面サイズ変更時のリスナーを追加
                const handleResize = () => {
                    if (!appRef.current || !modelRef.current || !currentCanvas.parentElement) return;

                    const parent = currentCanvas.parentElement;
                    const newWidth = Math.max(parent.clientWidth || 800, 1);
                    const newHeight = Math.max(parent.clientHeight || 600, 1);

                    // Rendererのサイズを更新
                    appRef.current.renderer.resize(newWidth, newHeight);

                    // モデルの位置とスケールを再計算
                    const newScaleX = (newWidth * scaleFactor) / modelRef.current.width;
                    const newScaleY = (newHeight * scaleFactor) / modelRef.current.height;
                    const newScale = Math.min(newScaleX, newScaleY);

                    modelRef.current.scale.set(newScale);
                    modelRef.current.x = newWidth / 2;
                    modelRef.current.y = newHeight / 2;
                };

                window.addEventListener('resize', handleResize);

                // クリーンアップ用にリスナーを保存
                (app as any)._resizeHandler = handleResize;

            } catch (e) {
                console.error('Failed to load Live2D model:', e);
                const errorMessage = e instanceof Error ? e.message : 'Unknown error during Live2D loading.';
                setError(errorMessage);
            }
        };

        init();

        return () => {
            // クリーンアップ
            if (modelRef.current) {
                modelRef.current.destroy();
                modelRef.current = null;
            }

            if (appRef.current) {
                // リサイズリスナーを削除
                const resizeHandler = (appRef.current as any)._resizeHandler;
                if (resizeHandler) {
                    window.removeEventListener('resize', resizeHandler);
                }

                // canvas自体はReactが管理するのでremoveView: falseにする
                appRef.current.destroy(false, { children: true });
                appRef.current = null;
            }
        };
    }, [modelPath]); // modelPathが変わったら再実行

    // エラー表示UI
    if (error) {
        return (
            <div className="flex items-center justify-center w-full h-full bg-red-100 border border-red-400 rounded-lg p-4">
                <p className="text-red-700 font-medium text-center">Live2D表示エラー: {error}</p>
            </div>
        );
    }

    // メインのcanvas要素。Tailwindでフルサイズを確保。
    return <canvas ref={canvasRef} className="w-full h-full block" />;
}