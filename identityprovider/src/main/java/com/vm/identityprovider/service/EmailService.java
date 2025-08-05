package com.vm.identityprovider.service;

import org.springframework.stereotype.Service;

@Service
public class EmailService {
    private final NotificationService notificationService;

    public EmailService(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    public void sendWelcomeEmail(String to) {
        // ...send email logic...
        notificationService.notifyUser(to, "Welcome!");
    }
}