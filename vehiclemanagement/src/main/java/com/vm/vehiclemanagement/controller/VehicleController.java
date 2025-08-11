package com.vm.vehiclemanagement.controller;

import com.vm.vehiclemanagement.Entity.ServiceListCollection;
import jakarta.validation.Valid;
import java.util.Optional;

import com.vm.vehiclemanagement.Entity.Vehicle;
import com.vm.vehiclemanagement.repository.VehicleRepository;

import org.hibernate.annotations.Parameter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/vehicle")
public class VehicleController {

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
      final String country) {
    final boolean vehicleExists = vehicleRepository.findByVinAndBrandAndCountry(vin, brand, country)
        .isPresent();
    if (vehicleExists) {
      return ResponseEntity.status(HttpStatus.OK).body("Vehicle is registered");
    } else {
      return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Vehicle not yet registered");
    }
  }

  @RequestMapping(
      method = RequestMethod.GET,
      value = "/downloadSL/{checksumV8}",
      produces = {"application/serviceList_v8_0_0+xml", "application/json", "text/html"}
  )
  ResponseEntity<ServiceListCollection> downloadSLV8(
      @RequestParam(name = "checksum") String checksum, @PathVariable("checksumV8") String checksumV8) {
    ServiceListCollection serviceListCollection = new ServiceListCollection();
    ResponseEntity<ServiceListCollection> responseEntity = ResponseEntity.status(HttpStatus.OK).body(serviceListCollection);
    return responseEntity;
  }

  @RequestMapping(
      method = RequestMethod.PUT,
      value = "/uploadIB/{checksumV8}",
      produces = {"application/serviceList_v8_0_0+xml", "application/json", "text/html"},
      consumes = {"application/installedBase_v6_0_1+xml"}
  )
  ResponseEntity<ServiceListCollection> uploadIBV8(
      @PathVariable("checksumV8") String checksumV8,
      @RequestBody ServiceListCollection.InstalledBaseCollection installedBaseCollection) {
    ServiceListCollection serviceListCollection = new ServiceListCollection();
    ResponseEntity<ServiceListCollection> responseEntity = ResponseEntity.status(HttpStatus.OK).body(serviceListCollection);
    return responseEntity;
  }
}