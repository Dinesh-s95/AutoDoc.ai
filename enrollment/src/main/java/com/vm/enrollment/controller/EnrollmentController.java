package com.vm.enrollment.controller;

import com.vm.enrollment.service.EnrollmentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/enrollment")
public class EnrollmentController {

    @Autowired
    private EnrollmentService service;

    @PostMapping("/nominate-primary")
    public String nominatePrimary(@RequestParam String username) {
        return service.nominatePrimaryUser(username);
    }

    @PostMapping("/nominate-secondary")
    public String nominateSecondary(@RequestParam String username) {
        return service.nominateSecondary(username);
    }
}
