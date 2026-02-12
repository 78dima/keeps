"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
// import api from "@/lib/api"; // Legacy API disabled

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function PushNotificationManager() {
    const [isSupported, setIsSupported] = useState(false);
    const [subscription, setSubscription] = useState<PushSubscription | null>(null);

    useEffect(() => {
        if ("serviceWorker" in navigator && "PushManager" in window) {
            setIsSupported(true);
            registerServiceWorker();
        }
    }, []);

    async function registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register("/sw.js", {
                scope: "/",
                updateViaCache: "none",
            });
            console.log("Service Worker registered:", registration);

            const sub = await registration.pushManager.getSubscription();
            setSubscription(sub);
        } catch (error) {
            console.error("Service Worker registration failed:", error);
        }
    }

    async function subscribeToPush() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const sub = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(
                    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
                ),
            });
            setSubscription(sub);

            // Supabase Integration
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
                const p256dh = sub.getKey('p256dh');
                const auth = sub.getKey('auth');

                if (p256dh && auth) {
                    const p256dhStr = arrayBufferToBase64(p256dh);
                    const authStr = arrayBufferToBase64(auth);

                    const { error } = await supabase.from('push_subscriptions').upsert({
                        user_id: session.user.id,
                        endpoint: sub.endpoint,
                        p256dh: p256dhStr,
                        auth: authStr,
                        user_agent: navigator.userAgent
                    }, { onConflict: 'user_id, endpoint' });

                    if (error) {
                        console.error("Failed to save subscription to Supabase:", error);
                    } else {
                        console.log("Subscription saved to Supabase");
                    }
                }
            }

            alert("Subscribed to Notifications!");
        } catch (error) {
            console.error("Subscription failed:", error);
            alert("Failed to subscribe.");
        }
    }

    function arrayBufferToBase64(buffer: ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    if (!isSupported) {
        return null; // or <p>Push not supported</p>
    }

    return (
        <div className="fixed bottom-4 right-4 z-50">
            {!subscription && (
                <button
                    onClick={subscribeToPush}
                    className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-700 transition"
                >
                    Enable Notifications
                </button>
            )}
        </div>
    );
}
