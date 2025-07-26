package com.vm.usermanagement.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "vehiclemanagement", url = "http://localhost:8082/api/vehicle")
public interface VehicleManagementClient {
    @GetMapping("/verify")
    String verifyVehicle(@RequestParam String vin, @RequestParam String brand, @RequestParam String country);
}
