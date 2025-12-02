'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
// NOTE: Kalidokit will be dynamically imported at runtime to avoid bundler issues
// NOTE: Do NOT statically import `@mediapipe/face_mesh` because some bundlers
// (Turbopack) statically analyze modules and this package may not expose
// static ESM exports. We'll dynamically import it at runtime inside the
// client-only effect below.
// NOTE: Do NOT statically import `@mediapipe/camera_utils` here because
// some bundlers (Turbopack) statically analyze modules and this package
// may not expose static ESM exports. We'll dynamically import it at
// runtime inside the client-only effect below.

// PIXIをwindowオブジェクトに露出させる
if (typeof window !== 'undefined') {
    (window as any).PIXI = PIXI;
    if (PIXI.Ticker && PIXI.Ticker.shared) {
        console.log('PIXI.Ticker.shared is available globally');
    }
}

interface Live2DCameraViewerProps {
    modelPath: string;
}

/**
 * カメラで人の動きを認識してLive2Dモデルを動かすコンポーネント
 * @param {Live2DCameraViewerProps} props - モデルのパスを含むプロパティ
 */
export default function Live2DCameraViewer({ modelPath }: Live2DCameraViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);
    const faceMeshRef = useRef<any | null>(null);

    // camera utilities は動的インポートするため汎用 any 型を使用
    const cameraRef = useRef<any | null>(null);

    // モデル切替用の state
    const [selectedModelPath, setSelectedModelPath] = useState<string>(modelPath);
    // 利用可能なモデルのリスト
    // 利用可能なモデルのリスト
    const [modelOptions, setModelOptions] = useState<{ label: string; path: string }[]>([
        { label: 'Default', path: modelPath },
    ]);

    // APIからモデル一覧を取得
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const res = await fetch('/api/models');
                if (res.ok) {
                    const data = await res.json();
                    if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                        setModelOptions(data.models);

                        // 現在選択中のパスがリストにあるか確認し、なければリストの最初のものを選択する等の処理も可能だが
                        // ここではリストの更新のみを行う
                    }
                }
            } catch (error) {
                console.error('Failed to fetch models:', error);
            }
        };
        fetchModels();
    }, []);

    // 共通スケール係数
    const SCALE_FACTOR = 0.8;

    // モデル読み込み関数（切替時に既存モデルを破棄して新しいモデルを読み込む）
    const loadModel = async (path: string) => {
        if (!appRef.current) {
            console.warn('PIXI app not initialized yet.');
            return;
        }

        try {
            // 既存モデルの破棄
            if (modelRef.current) {
                try {
                    modelRef.current.destroy();
                } catch (e) {
                    console.warn('Error destroying previous model:', e);
                }
                modelRef.current = null;
            }

            const model = await Live2DModel.from(path);
            modelRef.current = model;

            if ('autoUpdate' in model) {
                (model as any).autoUpdate = true;
            }

            // モデルの配置とスケール調整
            model.x = appRef.current.screen.width / 2;
            model.y = appRef.current.screen.height / 2;
            model.anchor.set(0.5, 0.5);

            const scaleX = (appRef.current.screen.width * SCALE_FACTOR) / model.width;
            const scaleY = (appRef.current.screen.height * SCALE_FACTOR) / model.height;
            const scale = Math.min(scaleX, scaleY);
            model.scale.set(scale);

            appRef.current.stage.addChild(model as any);
        } catch (e) {
            console.error('Failed to load model:', e);
            setError('モデルの読み込みに失敗しました: ' + (e instanceof Error ? e.message : String(e)));
        }
    };

    useEffect(() => {
        const currentCanvas = canvasRef.current;
        const currentVideo = videoRef.current;

        if (!currentCanvas || !currentVideo || appRef.current) return;

        if (!(window as any).Live2DCubismCore) {
            setError('Live2D Core Library (Live2DCubismCore) not loaded. Check script loading order.');
            return;
        }

        const init = async () => {
            try {
                // 親要素のサイズが確定するまで待機
                const waitForParentSize = (): Promise<{ width: number; height: number }> => {
                    return new Promise((resolve) => {
                        let attempts = 0;
                        const maxAttempts = 100;

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

                            if (attempts >= maxAttempts) {
                                resolve({ width: 800, height: 600 });
                                return;
                            }

                            requestAnimationFrame(checkSize);
                        };
                        checkSize();
                    });
                };

                const { width: parentWidth, height: parentHeight } = await waitForParentSize();
                const width = Math.max(parentWidth, 1);
                const height = Math.max(parentHeight, 1);

                // 1. PIXI Applicationの作成
                const app = new PIXI.Application({
                    view: currentCanvas,
                    transparent: true,
                    width: width,
                    height: height,
                    resolution: window.devicePixelRatio || 1,
                    autoDensity: true,
                });
                appRef.current = app;

                // Applicationの初期化を待つ
                await new Promise(resolve => {
                    if (app.ticker.started) {
                        resolve(undefined);
                    } else {
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

                // Tickerの登録
                try {
                    if (!app.ticker || typeof app.ticker.add !== 'function') {
                        throw new Error('Ticker initialization failed');
                    }

                    if (PIXI.Ticker) {
                        Live2DModel.registerTicker(PIXI.Ticker as any);
                        console.log('Ticker registered successfully');
                    }
                } catch (e) {
                    console.error("Failed to register ticker:", e);
                    setError('Failed to initialize Ticker for Live2D model.');
                    return;
                }

                // 2. Live2Dモデルのロード（初回は selectedModelPath を使う）
                await new Promise(resolve => setTimeout(resolve, 100));
                await loadModel(selectedModelPath);

                // 3. MediaPipe Face Meshの初期化（動的インポート）
                let FaceMeshCtor: any = null;
                try {
                    const fm = await import('@mediapipe/face_mesh');
                    FaceMeshCtor = fm?.FaceMesh ?? fm?.default?.FaceMesh ?? fm?.default ?? (window as any).FaceMesh;
                } catch (e) {
                    FaceMeshCtor = (window as any).FaceMesh;
                }

                if (!FaceMeshCtor) {
                    throw new Error('MediaPipe FaceMesh constructor not found. Ensure the package is available or load via CDN.');
                }

                const faceMesh = new FaceMeshCtor({
                    locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
                });

                faceMesh.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                // Kalidokitの動的インポート
                let Kalidokit: any = null;
                try {
                    Kalidokit = await import('kalidokit');
                    console.log('✅ Kalidokit loaded successfully:', Kalidokit);
                } catch (e) {
                    console.warn('⚠️ Kalidokit not found, using manual parameter calculation:', e);
                }

                // 顔の動きをLive2Dパラメータに変換する関数
                // スムージング変数（Kalidokit用とフォールバック用）
                let smoothedAngleX = 0;
                let smoothedAngleY = 0;
                let smoothedAngleZ = 0;
                let smoothedBodyAngleX = 0;
                let smoothedBodyAngleY = 0;
                let smoothedBodyAngleZ = 0;
                let smoothedMouthOpen = 0;
                let smoothedLeftEyeOpen = 0;
                let smoothedRightEyeOpen = 0;
                let smoothedEyeX = 0;
                let smoothedEyeY = 0;
                let smoothedHeadX = 0;
                let smoothedHeadY = 0;

                // スムージング係数（値が小さいほど滑らか、大きいほど反応が速い）
                const SMOOTHING_FACTOR = 0.3; // 0.3で滑らかな動き

                // デバッグ用のフレームカウンター
                let debugFrameCount = 0;

                const updateLive2DParameters = (results: any) => {
                    debugFrameCount++;
                    const shouldLog = debugFrameCount % 60 === 0; // 60フレームに1回ログ

                    if (!modelRef.current || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
                        if (shouldLog) console.log('⚠️ No face detected or model not ready');
                        return;
                    }

                    const landmarks = results.multiFaceLandmarks[0];
                    const model = modelRef.current;
                    if (shouldLog) console.log('👤 Face detected, landmarks:', landmarks.length, 'points');

                    try {
                        // pixi-live2d-displayのinternalModelを使用
                        const internalModel = (model as any).internalModel;
                        if (shouldLog) console.log('🎭 InternalModel:', internalModel ? 'Available' : 'Not available');
                        if (!internalModel) {
                            if (shouldLog) console.warn('⚠️ InternalModel not available');
                            return;
                        }

                        // パラメータIDを取得して値を設定（正しいAPI使用）
                        const setParameter = (paramId: string, value: number) => {
                            try {
                                // Live2D Cubism 4のパラメータ設定方法
                                if (internalModel.coreModel) {
                                    const paramIndex = internalModel.coreModel.getParameterIndex(paramId);
                                    if (paramIndex >= 0) {
                                        internalModel.coreModel.setParameterValueById(paramId, value);
                                    }
                                }
                            } catch (e) {
                                // パラメータが存在しない場合は無視
                            }
                        };

                        if (Kalidokit && Kalidokit.Face) {
                            if (shouldLog) console.log('🚀 Using Kalidokit for parameter calculation');
                            // Kalidokitを使用した高精度なパラメータ計算
                            const riggedFace = Kalidokit.Face.solve(landmarks, {
                                runtime: 'mediapipe',
                                video: videoRef.current,
                                imageSize: { width: 640, height: 480 },
                                smoothBlink: true,
                                blinkSettings: [0.25, 0.75]
                            });

                            if (riggedFace) {
                                // 頭の回転 - Kalidokitは度数で返すので、Live2Dの範囲に合わせる
                                if (riggedFace.head) {
                                    const { x, y, z } = riggedFace.head.degrees;
                                    // Live2Dは通常-30〜30の範囲なので、適切にスケーリング
                                    const targetAngleX = Math.max(-30, Math.min(30, x));
                                    const targetAngleY = Math.max(-30, Math.min(30, y));
                                    const targetAngleZ = Math.max(-30, Math.min(30, z));

                                    // スムージング適用（指数移動平均）
                                    smoothedAngleX += (targetAngleX - smoothedAngleX) * SMOOTHING_FACTOR;
                                    smoothedAngleY += (targetAngleY - smoothedAngleY) * SMOOTHING_FACTOR;
                                    smoothedAngleZ += (targetAngleZ - smoothedAngleZ) * SMOOTHING_FACTOR;

                                    if (shouldLog) console.log('Head angles:', {
                                        raw: { x: targetAngleX, y: targetAngleY, z: targetAngleZ },
                                        smoothed: { x: smoothedAngleX, y: smoothedAngleY, z: smoothedAngleZ }
                                    });

                                    setParameter('ParamAngleX', smoothedAngleX);
                                    setParameter('ParamAngleY', smoothedAngleY);
                                    setParameter('ParamAngleZ', smoothedAngleZ);

                                    // 体の角度も設定（さらに滑らかに）
                                    const targetBodyX = smoothedAngleX * 0.5;
                                    const targetBodyY = smoothedAngleY * 0.5;
                                    const targetBodyZ = smoothedAngleZ * 0.5;

                                    smoothedBodyAngleX += (targetBodyX - smoothedBodyAngleX) * SMOOTHING_FACTOR;
                                    smoothedBodyAngleY += (targetBodyY - smoothedBodyAngleY) * SMOOTHING_FACTOR;
                                    smoothedBodyAngleZ += (targetBodyZ - smoothedBodyAngleZ) * SMOOTHING_FACTOR;

                                    setParameter('ParamBodyAngleX', smoothedBodyAngleX);
                                    setParameter('ParamBodyAngleY', smoothedBodyAngleY);
                                    setParameter('ParamBodyAngleZ', smoothedBodyAngleZ);
                                }

                                // 目の動き (0-1の範囲)
                                if (riggedFace.eye) {
                                    const { l, r } = riggedFace.eye;
                                    setParameter('ParamEyeLOpen', l);
                                    setParameter('ParamEyeROpen', r);
                                }

                                // 瞳の動き (-1〜1の範囲)
                                if (riggedFace.pupil) {
                                    setParameter('ParamEyeBallX', riggedFace.pupil.x);
                                    setParameter('ParamEyeBallY', riggedFace.pupil.y);
                                }

                                // 口の動き
                                if (riggedFace.mouth) {
                                    setParameter('ParamMouthOpenY', riggedFace.mouth.y);
                                    if (riggedFace.mouth.x !== undefined) {
                                        setParameter('ParamMouthForm', riggedFace.mouth.x);
                                    }
                                }

                                // 眉の動き
                                if (riggedFace.brow) {
                                    setParameter('ParamBrowLY', riggedFace.brow.l);
                                    setParameter('ParamBrowRY', riggedFace.brow.r);
                                }
                            }
                        } else {
                            // Kalidokitが利用できない場合のフォールバック（元のロジック）
                            const noseTip = landmarks[1];
                            const leftEye = landmarks[33];
                            const rightEye = landmarks[263];
                            const leftEar = landmarks[234];
                            const rightEar = landmarks[454];

                            const faceCenterX = (leftEye.x + rightEye.x) / 2;
                            const faceCenterY = (leftEye.y + rightEye.y) / 2;

                            const screenCenterX = 0.5;
                            const screenCenterY = 0.5;

                            const headPosX = (faceCenterX - screenCenterX) * 100;
                            const headPosY = (faceCenterY - screenCenterY) * 100;

                            smoothedHeadX += (headPosX - smoothedHeadX) * SMOOTHING_FACTOR;
                            smoothedHeadY += (headPosY - smoothedHeadY) * SMOOTHING_FACTOR;

                            const rawAngleX = (noseTip.x - faceCenterX) * 200;
                            smoothedAngleX += (rawAngleX - smoothedAngleX) * SMOOTHING_FACTOR;

                            const rawAngleY = (noseTip.y - faceCenterY) * 200;
                            smoothedAngleY += (rawAngleY - smoothedAngleY) * SMOOTHING_FACTOR;

                            const rawAngleZ = (leftEar.y - rightEar.y) * 200;
                            smoothedAngleZ += (rawAngleZ - smoothedAngleZ) * SMOOTHING_FACTOR;

                            const eyeLookX = (noseTip.x - faceCenterX) * 150;
                            smoothedEyeX += (eyeLookX - smoothedEyeX) * SMOOTHING_FACTOR;

                            const eyeLookY = (noseTip.y - faceCenterY) * 150;
                            smoothedEyeY += (eyeLookY - smoothedEyeY) * SMOOTHING_FACTOR;

                            const upperLip = landmarks[13];
                            const lowerLip = landmarks[14];
                            const rawMouthOpen = Math.abs(upperLip.y - lowerLip.y) * 40;
                            smoothedMouthOpen += (rawMouthOpen - smoothedMouthOpen) * SMOOTHING_FACTOR;

                            const leftEyeTop = landmarks[159];
                            const leftEyeBottom = landmarks[145];
                            const rightEyeTop = landmarks[386];
                            const rightEyeBottom = landmarks[374];
                            const rawLeftEyeOpen = Math.abs(leftEyeTop.y - leftEyeBottom.y) * 30;
                            const rawRightEyeOpen = Math.abs(rightEyeTop.y - rightEyeBottom.y) * 30;

                            smoothedLeftEyeOpen += (rawLeftEyeOpen - smoothedLeftEyeOpen) * SMOOTHING_FACTOR;
                            smoothedRightEyeOpen += (rawRightEyeOpen - smoothedRightEyeOpen) * SMOOTHING_FACTOR;

                            setParameter('ParamBodyAngleX', Math.max(-30, Math.min(30, smoothedHeadX)));
                            setParameter('ParamAngleX', Math.max(-70, Math.min(70, smoothedAngleX)));
                            setParameter('ParamAngleY', Math.max(-70, Math.min(70, smoothedAngleY)));
                            setParameter('ParamAngleZ', Math.max(-50, Math.min(50, smoothedAngleZ)));
                            setParameter('ParamMouthOpenY', Math.max(0, Math.min(1, smoothedMouthOpen)));
                            setParameter('ParamEyeLOpen', Math.max(0, Math.min(1, smoothedLeftEyeOpen)));
                            setParameter('ParamEyeROpen', Math.max(0, Math.min(1, smoothedRightEyeOpen)));
                            setParameter('ParamEyeBallX', Math.max(-1, Math.min(1, smoothedEyeX)));
                            setParameter('ParamEyeBallY', Math.max(-1, Math.min(1, smoothedEyeY)));
                        }
                    } catch (e) {
                        console.warn('Could not update Live2D parameters:', e);
                    }
                };

                faceMesh.onResults((results: any) => {
                    updateLive2DParameters(results);
                });

                faceMeshRef.current = faceMesh;

                // 4. カメラの初期化
                const startCamera = async () => {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: { width: 640, height: 480 }
                        });

                        currentVideo.srcObject = stream;
                        currentVideo.play();
                        setIsCameraActive(true);

                        // MediaPipe Cameraの初期化（動的インポート）
                        let CameraCtor: any = null;
                        try {
                            const camModule = await import('@mediapipe/camera_utils');
                            CameraCtor = camModule?.Camera ?? camModule?.default?.Camera ?? (window as any).Camera;
                        } catch (e) {
                            // 動的インポートが失敗した場合は window にアタッチされていないか確認
                            CameraCtor = (window as any).Camera;
                        }

                        if (!CameraCtor) {
                            console.warn('MediaPipe Camera constructor not found. Falling back to using video frames directly.');
                        } else {
                            const camera = new CameraCtor(currentVideo, {
                                onFrame: async () => {
                                    await faceMesh.send({ image: currentVideo });
                                },
                                width: 640,
                                height: 480
                            });
                            camera.start();
                            cameraRef.current = camera;
                        }
                    } catch (err) {
                        console.error('Error accessing camera:', err);
                        setError('カメラへのアクセスに失敗しました。カメラの権限を確認してください。');
                    }
                };

                // カメラを開始
                await startCamera();

                // リサイズハンドラー
                const handleResize = () => {
                    if (!appRef.current || !modelRef.current || !currentCanvas.parentElement) return;

                    const parent = currentCanvas.parentElement;
                    const newWidth = Math.max(parent.clientWidth || 800, 1);
                    const newHeight = Math.max(parent.clientHeight || 600, 1);

                    appRef.current.renderer.resize(newWidth, newHeight);

                    const newScaleX = (newWidth * SCALE_FACTOR) / modelRef.current.width;
                    const newScaleY = (newHeight * SCALE_FACTOR) / modelRef.current.height;
                    const newScale = Math.min(newScaleX, newScaleY);

                    modelRef.current.scale.set(newScale);
                    modelRef.current.x = newWidth / 2;
                    modelRef.current.y = newHeight / 2;
                };

                window.addEventListener('resize', handleResize);
                (app as any)._resizeHandler = handleResize;

            } catch (e) {
                console.error('Failed to initialize Live2D camera viewer:', e);
                const errorMessage = e instanceof Error ? e.message : 'Unknown error during initialization.';
                setError(errorMessage);
            }
        };

        init();

        return () => {
            // クリーンアップ
            if (cameraRef.current) {
                cameraRef.current.stop();
                cameraRef.current = null;
            }

            if (faceMeshRef.current) {
                faceMeshRef.current.close();
                faceMeshRef.current = null;
            }

            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }

            if (modelRef.current) {
                modelRef.current.destroy();
                modelRef.current = null;
            }

            if (appRef.current) {
                const resizeHandler = (appRef.current as any)._resizeHandler;
                if (resizeHandler) {
                    window.removeEventListener('resize', resizeHandler);
                }
                appRef.current.destroy(false, { children: true });
                appRef.current = null;
            }
        };
    }, [modelPath]);

    // 選択モデルが変わったらモデル読み込みを行う
    useEffect(() => {
        if (!selectedModelPath) return;
        // app が初期化済みなら読み込み、まだなら init の中で初回読み込みされる
        if (appRef.current) {
            loadModel(selectedModelPath);
        }
    }, [selectedModelPath]);

    if (error) {
        return (
            <div className="flex items-center justify-center w-full h-full bg-red-100 border border-red-400 rounded-lg p-4">
                <p className="text-red-700 font-medium text-center">エラー: {error}</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col items-center gap-4">
            <div className="w-full flex justify-end mb-2">
                <label className="mr-2 text-sm text-gray-700">モデル切替:</label>
                <select
                    value={selectedModelPath}
                    onChange={(e) => {
                        const p = e.target.value;
                        setSelectedModelPath(p);
                    }}
                    className="border rounded px-2 py-1 text-sm bg-white"
                >
                    {modelOptions.map((option) => (
                        <option key={option.path} value={option.path}>{option.label}</option>
                    ))}
                </select>
            </div>
            <div className="relative w-full h-full">
                <canvas ref={canvasRef} className="w-full h-full block border-2 border-gray-300 rounded-lg" />
                <video
                    ref={videoRef}
                    className="absolute top-4 right-4 w-48 h-36 border-2 border-blue-500 rounded-lg opacity-50"
                    autoPlay
                    playsInline
                    muted
                />
            </div>
            {isCameraActive && (
                <div className="text-sm text-gray-600">
                    カメラがアクティブです。顔を動かしてアバターを操作してください。
                </div>
            )}
        </div>
    );
}