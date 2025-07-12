package com.vm.vehiclemanagement.controller;

import java.util.Optional;

import com.vm.vehiclemanagement.Entity.Vehicle;
import com.vm.vehiclemanagement.repository.VehicleRepository;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/vehicle")
public class VehicleController{

    @Autowired
    private VehicleRepository vehicleRepository;

    @PostMapping("/register")
    public ResponseEntity<Object> registerVehicle(@RequestBody @Validated Vehicle vehicle) {
        final Optional<Vehicle> registeredVehicle = vehicleRepository.findByVinAndBrandAndCountry(vehicle.getVin(),
                vehicle.getBrand(), vehicle.getCountry());
        if (registeredVehicle.isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body("Vehicle already registered");
        }
        vehicleRepository.save(vehicle);
        return ResponseEntity.status(HttpStatus.CREATED).body("Vehicle registered successfully");
    }

    @GetMapping("/verify")
    public ResponseEntity<Object> verifyRegistration(@RequestParam final String vin, final String brand,
            final String country){
        final boolean vehicleExists = vehicleRepository.findByVinAndBrandAndCountry(vin, brand, country)
                .isPresent();
        if(vehicleExists){
            return ResponseEntity.status(HttpStatus.OK).body("Vehicle is registered");
        } else {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Vehicle not yet registered");
        }
    }
}