package com.vm.vehiclemanagement.repository;

import java.util.Optional;

import com.vm.vehiclemanagement.Entity.Vehicle;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface VehicleRepository extends JpaRepository<Vehicle, String> {
    Optional<Vehicle> findByVinAndBrandAndCountry(String vin, String brand, String country);
}
