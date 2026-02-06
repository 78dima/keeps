import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';

@Injectable()
export class WebPushService implements OnModuleInit {
    constructor(private configService: ConfigService) { }

    onModuleInit() {
        const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
        const subject = 'mailto:admin@monokeep.com'; // Default contact email

        if (publicKey && privateKey) {
            webPush.setVapidDetails(subject, publicKey, privateKey);
        } else {
            console.warn('VAPID keys not found, Web Push disabled');
        }
    }

    async sendNotification(subscription: any, payload: any) {
        try {
            await webPush.sendNotification(subscription, JSON.stringify(payload));
            return true;
        } catch (error) {
            console.error('Error sending web push notification', error);
            return false;
        }
    }
}
