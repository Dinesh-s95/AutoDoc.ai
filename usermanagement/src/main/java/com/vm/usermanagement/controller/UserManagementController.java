package com.vm.usermanagement.controller;

import com.vm.usermanagement.service.UserManagementService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/user-management")
public class UserManagementController {

    @Autowired
    private UserManagementService service;

    @PostMapping("/onboard")
    public String onboardUser(@RequestParam String username, @RequestParam String password) {
        return service.onboardUser(username, password);
    }

    @PostMapping("/assign-vehicle")
    public String assignVehicle(@RequestParam String username,
            @RequestParam String vin,
            @RequestParam String brand,
            @RequestParam String country) {
        service.assignVehicleToUser(username, vin, brand, country);
        return "Vehicle assigned successfully";
    }
}
